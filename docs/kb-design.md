# KB — 个人知识库问答系统 · 设计文档 (v1 draft)

> 目标：在现有 `apps/server`（FastAPI + PostgreSQL）里落一套**源无关（source-agnostic）的可插拔知识库**，
> blog 只是接进来的第一个数据源，未来接笔记 / 代码 / web / 外部资料。站内提供一个终端风的 AI 问答，
> 答案带**引用回链**。工程由本仓库实现；用到 LLM 的地方走可配置的 OpenAI 兼容端点（生成用 DeepSeek）。

---

## 0. 目标 / 非目标

**目标（v1）**
- 一套通用 ingest 管线：任意源实现一个薄 `Ingester` 就能把内容灌进知识库。
- 第一个源 = blog（读现有 `post` 表），端到端打通"问答 + 引用"。
- 混合检索（pgvector 向量 + Postgres 全文，RRF 融合），可按源过滤/加权。
- 前端终端式对话框，SSE 流式输出，引用作可点链接。
- LLM / 嵌入全走 **env 配置的 OpenAI 兼容 API**（不在生产机跑本地模型 —— 那台 1.6G 刚 OOM 过）。

**非目标（v1，明确不做）**
- GraphRAG / 多跳 agent / 重排 rerank（语料小，先不需要；留作 v2 按失败模式再加）。
- 本地嵌入 / 本地推理（内存受限）。
- 部署 Dify/Onyx/RAGFlow 这类重平台（多容器吃内存，当前机器扛不住）。
- 非文本源（casino 逻辑、lab 玩具）纳入问答 —— 留到 v2，见 §12。

---

## 1. 总体架构

```
                          ┌─────────────── ingest（离线/触发式）────────────────┐
  post 表 ──BlogIngester──┤                                                     │
  （未来）笔记 ─Notes─────┤  fetch() → 分块 → 嵌入(Embedder) → upsert          │
  （未来）代码 ─Code──────┤                       │                             │
  （未来）web  ─Web───────┘                       ▼                             │
                                    Postgres: kb_source / kb_document / kb_chunk │
                                              (embedding vector + tsv tsvector)  │
                          └─────────────────────────────────────────────────────┘

                          ┌─────────────── 问答（在线）─────────────────────────┐
  前端终端对话框 ──POST /api/ask──►  Retriever: 向量召回 + 全文召回 → RRF 融合   │
       ▲                              → top-k chunks → 组 prompt                 │
       └──────── SSE 流式 ◄────────── ChatLLM(DeepSeek) 生成带引用答案            │
                          └─────────────────────────────────────────────────────┘
```

两层解耦：**ingest 层**只管"把各种源变成带向量的 chunk"；**问答层**只管"检索 + 生成"。加新源只碰 ingest 层。

---

## 2. 数据模型

新表放 `app/db/models.py`（SQLAlchemy），迁移走 alembic。三张表：

```sql
-- 源：一类内容的接入点（blog / notes / code / web ...）
CREATE TABLE kb_source (
    id            SERIAL PRIMARY KEY,
    kind          TEXT NOT NULL,              -- 'blog' | 'notes' | 'code' | 'web'
    name          TEXT NOT NULL,              -- 展示名，如 "blog"
    config        JSONB NOT NULL DEFAULT '{}',-- 源特定配置（路径 / repo / url 规则…）
    enabled       BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    UNIQUE (kind, name)
);

-- 文档：源里的一个条目（一篇文章 / 一个笔记文件 / 一个代码文件…）
CREATE TABLE kb_document (
    id           SERIAL PRIMARY KEY,
    source_id    INT NOT NULL REFERENCES kb_source(id) ON DELETE CASCADE,
    external_id  TEXT NOT NULL,               -- 源内唯一：post.slug / 文件路径 …
    title        TEXT NOT NULL,
    url          TEXT,                         -- 引用回链（如 /posts/<slug>/）
    raw_md       TEXT NOT NULL,                -- 干净正文（blog 直接用 content）
    content_hash TEXT NOT NULL,                -- 增量：变了才重嵌
    meta         JSONB NOT NULL DEFAULT '{}',  -- tags / 发布时间 / 语言 …
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_id)
);

-- 分块：检索最小单元
CREATE TABLE kb_chunk (
    id           SERIAL PRIMARY KEY,
    document_id  INT NOT NULL REFERENCES kb_document(id) ON DELETE CASCADE,
    ord          INT NOT NULL,                 -- 块在文档内的序
    content      TEXT NOT NULL,                -- 用于喂 LLM 的块正文
    -- embedding VECTOR(<dim>)                 -- v0 先不建（OpenRouter 无嵌入，见 §3）；
    --                                            升级时迁移 ALTER TABLE ADD COLUMN embedding VECTOR(<dim>)
    tsv          TSVECTOR,                     -- Postgres 全文（simple/中文分词见 §5 注）
    meta         JSONB NOT NULL DEFAULT '{}',
    UNIQUE (document_id, ord)
);

-- 索引
CREATE INDEX kb_chunk_tsv_gin  ON kb_chunk USING GIN (tsv);
-- 注意：pgvector 的 hnsw/ivfflat 索引对 `vector` 类型上限 2000 维，而 gemini-embedding-2 是 3072 维，
-- 无法直接建 ANN 索引。v1 语料小（数百块），直接精确扫描（brute-force cosine）即可，毫秒级、无需索引。
-- 规模变大后的升级路径：改 `halfvec(3072)`（pgvector≥0.7 支持对 halfvec 建 hnsw，上限 4000 维），
-- 或用 Matryoshka 降维（gemini 支持输出更小维度）。
```

迁移里先 `CREATE EXTENSION IF NOT EXISTS vector;`。
**"多源"的本质**：检索时可 `JOIN kb_document d ON ... WHERE d.source_id = ANY(:sources)` 按源过滤，或对不同源的 RRF 分数加权 —— blog 只是 `source_id` 之一。

---

## 3. Provider 抽象（LLM + 嵌入，OpenAI 兼容、env 配置）

两个独立 client，都用已有依赖 `httpx[http2]`，走 OpenAI 兼容协议（`/chat/completions`、`/embeddings`），**base_url / key / model 全从 env 读**，换供应商不改代码。

```python
# app/modules/kb/provider.py
class ChatLLM:      # 生成：DeepSeek（你提供）
    base_url = env("KB_LLM_BASE_URL")   # https://api.deepseek.com
    api_key  = env("KB_LLM_API_KEY")
    model    = env("KB_LLM_MODEL")       # deepseek-chat / v4flash
    async def stream(self, messages) -> AsyncIterator[str]: ...   # SSE 转发

class Embedder:     # 向量化：独立端点（见下方决策点）
    base_url = env("KB_EMBED_BASE_URL")
    api_key  = env("KB_EMBED_API_KEY")
    model    = env("KB_EMBED_MODEL")     # 决定 VECTOR(dim)
    async def embed(self, texts: list[str]) -> list[list[float]]: ...
```

> ✅ **已定（实测确认）：**
> - **生成**走 OpenRouter：`KB_LLM_BASE_URL=https://openrouter.ai/api/v1`、`KB_LLM_MODEL=deepseek/deepseek-v4-flash`
>   （1M 上下文、$0.089/$0.180 每 M token）、`KB_LLM_API_KEY=<放 .env>`。实测 chat 正常。
> - **嵌入暂缺**：OpenRouter 无 embedding 模型（models 列表筛 embed = 0），`google/gemini-embedding-2`
>   旁门已被 provider ToS 封（所有请求 403）。故 **v0 先不做嵌入**（`embedding` 列留空），检索只用
>   Postgres 全文（§5）。日后拿一个专用嵌入 key（SiliconFlow bge-m3 / OpenAI / Google AI 直连），
>   填 `KB_EMBED_*` 跑一次 reindex 即无缝升级成混合检索——表结构与代码都不用改。
> - 升级后维度随所选嵌入模型定（bge-m3=1024 / openai-3-small=1536 / gemini=3072），`VECTOR(dim)` 见 §2。

---

## 4. Ingestion 管线

```python
# app/modules/kb/ingest/base.py
class KBDocument(TypedDict):
    external_id: str; title: str; url: str | None; raw_md: str; meta: dict

class Ingester(Protocol):
    kind: str
    def fetch(self) -> Iterable[KBDocument]: ...   # 从源头拉全部/增量文档

# 通用管线（所有源共用）：
#   for doc in ingester.fetch():
#       if content_hash 未变: skip
#       chunks = chunk_markdown(doc.raw_md)         # §4.1
#       vecs   = await embedder.embed([c.content for c in chunks])
#       upsert kb_document + 覆盖写 kb_chunk（含 embedding + to_tsvector）
```

**第一个源**（v1 就它）：
```python
# app/modules/kb/ingest/blog.py
class BlogIngester:
    kind = "blog"
    def fetch(self):
        for p in posts_repo.list_all(only_published=True):
            yield KBDocument(external_id=p.slug, title=p.title,
                             url=f"/posts/{p.slug}/", raw_md=p.content,
                             meta={"tags": p.tags, "published_at": ...})
```

### 4.1 分块策略
- markdown 结构感知：按标题层级 + 段落切，目标 ~500–800 token/块、~10–15% overlap，避免把公式/代码块切断。
- 语料小（51 篇 ≈ 数百块），先用简单规则分块即可，不引第三方分块库。

### 4.2 触发方式
- admin 手动：`POST /api/kb/reindex?source=blog`（JWT）。
- 增量：按 `content_hash` 只重嵌变化的文档。
- 可选（v1.1）：发文/改文后 hook 自动增量。

### 4.3 （可选，v1.1）Contextual Retrieval
调研里的低成本提质法：每个 chunk 嵌入前，用 LLM 生成一句"这块在整篇里讲什么"的上下文前缀（Anthropic 报告检索失败 −49%）。加一次性 ingest 成本换质量。**v1 先不做，留开关。**

---

## 5. 检索（hybrid RRF）

一条 SQL 内两路召回 + RRF 融合（骨架，抄自官方参考实现思路）：

```sql
WITH vec AS (   -- 向量召回
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> :qvec) AS rank
  FROM kb_chunk c JOIN kb_document d ON d.id=c.document_id
  WHERE (:sources IS NULL OR d.source_id = ANY(:sources))
  ORDER BY c.embedding <=> :qvec LIMIT 40
),
fts AS (        -- 全文召回
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC) AS rank
  FROM kb_chunk c JOIN kb_document d ON d.id=c.document_id,
       plainto_tsquery('simple', :query) q
  WHERE c.tsv @@ q AND (:sources IS NULL OR d.source_id = ANY(:sources))
  ORDER BY ts_rank_cd(c.tsv, q) DESC LIMIT 40
)
SELECT id, SUM(score) AS rrf FROM (
  SELECT id, 1.0/(:k+rank) AS score FROM vec
  UNION ALL
  SELECT id, 1.0/(:k+rank) AS score FROM fts
) u GROUP BY id ORDER BY rrf DESC LIMIT :top_k;    -- k≈60, top_k≈6
```

> 注：中文全文分词，`to_tsvector('simple', …)` 只按空白切、对 CJK 不理想。v1 先用 `simple`（向量召回兜住语义，全文主要救精确词/代码/英文术语）；若中文精确匹配需求强，v2 再上 `pg_jieba`/`zhparser` 或 pg_bigm。这是**已知取舍**，不阻塞 v1。

---

## 6. 问答 API

```
POST /api/ask   (public, 限流)
  req:  { q: string, sources?: string[] }   // sources 省略=全部
  流程: embed(q) → hybrid retrieve top_k → 组 prompt（system 指令 + 引用块，
        块内容作“资料”不作“指令”，防注入）→ ChatLLM.stream → SSE
  resp (SSE): event: token  {delta}
              event: done   { citations: [{title, url}] }
```
- **防滥用**：按 IP 限流（复用现有中间件/analytics 的 UA 判定思路）、`q` 长度上限、并发上限。
- **鉴权**：v1 建议**公开 + 限流**（站内功能，跟 search 一样免登录）。若担心成本被刷，可加轻量校验。→ 决策点 2。
- **引用**：prompt 要求模型只依据给定块作答、给出处；后端把命中块的 `document.url/title` 作为 citations 附在 `done` 事件。

---

## 7. 前端（终端对话框）

- 复用终端设计系统（`terminal-*` 色板、mac 三色点 title bar、`~$` prompt），参考 `SearchModal.tsx` / `Console.tsx`。
- 形态：新页 `/ask`（或首页/搜索框旁一个入口）；输入框 + 流式回答区 + 引用作 `terminal-cyan` 可点链接。
- SSE：`EventSource` 或 fetch stream 读 `/api/ask`。
- 预渲染：`/ask` 是交互页，出个静态壳即可（跟 lab 玩具一样，不预渲染对话内容）。

---

## 8. 代码落位（符合 CLAUDE.md 模块约定）

```
app/modules/kb/
  __init__.py
  router.py        # public_router: POST /ask ; admin_router: POST /kb/reindex
  service.py       # 编排：ingest 管线 / ask 流程
  repository.py    # kb_source/document/chunk 的 CRUD + hybrid 检索 SQL
  schema.py        # AskRequest / Citation / ReindexResult …（Pydantic）
  provider.py      # ChatLLM + Embedder（OpenAI 兼容 httpx client）
  retrieval.py     # RRF 检索
  ingest/
    base.py        # Ingester Protocol + 通用管线 + chunk_markdown
    blog.py        # BlogIngester（v1）
app/db/models.py   # + KBSource / KBDocument / KBChunk
alembic/versions/  # + 迁移：CREATE EXTENSION vector + 三表 + 索引
```
`app/modules/__init__.py` 挂 `kb_public_router`（`/api/ask`）与 `kb_admin_router`（`/api/kb/reindex`）。

---

## 9. 依赖 / 迁移 / 部署

- `pyproject.toml` + `pgvector`（`pgvector.sqlalchemy.Vector` 列类型）；`uv sync`。
- alembic 迁移：`CREATE EXTENSION vector` + 三表 + 索引。**postgres:16-alpine 需装 pgvector**——`docker-compose.prod.yml` 的 postgres 镜像换成 `pgvector/pgvector:pg16`（同基于 pg16，兼容现有数据卷）。→ 决策点 3。
- env（写进 `.env.prod.sample`）：`KB_LLM_BASE_URL/API_KEY/MODEL`（DeepSeek）、`KB_EMBED_BASE_URL/API_KEY/MODEL`。
- OOM 机友好：嵌入/生成全在云端 API，Postgres 只多存数百 chunk（向量 ~ 数 MB），负担可忽略；问答限流防刷。
- 改了 schema → `pnpm gen:api-types` 重生成前端类型。
- 后端不自动部署，合并后 `pnpm deploy:server`。

---

## 10. 里程碑（每个可独立出 PR / 演示）

| M | 内容 | 产出 |
|---|---|---|
| **M1** | 数据模型 + 迁移 + provider + BlogIngester + `/api/kb/reindex` | 能把 blog 灌进 kb_chunk（带向量），`docker compose` 起 pgvector |
| **M2** | hybrid 检索 + `/api/ask`（SSE 流式 + 引用） | curl 就能问答，命中引用 |
| **M3** | 前端终端对话框 `/ask` | 站内可用、可演示 ✦ 成就感在这 |
| **M4**（可选） | Contextual Retrieval 提质 + 第二个源（NotesIngester 示例） | 证明"多源"可扩展 |

---

## 11. 需你拍板的决策点（汇总）

1. ~~嵌入端点~~ ✅ 已定：OpenRouter `google/gemini-embedding-2`，3072 维（实测确认）。生成：DeepSeek。
2. **/api/ask 是否公开**：建议公开 + IP 限流（同 search）；还是要登录/口令？
3. **postgres 镜像换 `pgvector/pgvector:pg16`**：确认可以（数据卷兼容，仅换镜像）。
4. **v1 是否上 Contextual Retrieval**：默认不上（先简单），你要更高质量可开。
5. **前端入口**：独立 `/ask` 页 / 还是塞进现有搜索框旁。

---

## 12. 开放问题（v2+）
- 非文本源（casino 概率逻辑、lab 玩具）如何表示进问答库（代码分块？元数据摘要？）——本轮不解。
- 中文全文分词升级（pg_jieba/zhparser）触发条件。
- 语料变大后是否加 rerank / 是否需要 GraphRAG（跨源综合问题出现时）。

---

## 13. 一句话总结
v1 就是：**Postgres 里加三张表 + 一个 `kb` 模块**，blog 先灌进去，`/api/ask` 做混合检索 + DeepSeek 生成带引用，前端一个终端对话框。**通用管线、blog 只是第一个源**，之后每接一个新源写个几十行的 ingester 即可。
