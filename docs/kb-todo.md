# KB 知识库 — TODO / Roadmap

> 可编辑的活清单。设计与取舍见 [kb-design.md](./kb-design.md)。

## ✅ 已上线（v0 · 2026-07-03 · PR #118）
- 源无关三表 `kb_source / kb_document / kb_chunk`（无 embedding 列）
- `BlogIngester`（读 `post` 表）+ 结构感知 markdown 分块
- 检索：pg_trgm `word_similarity`
- 生成：直连 DeepSeek（`deepseek-chat` = v4-flash），SSE 流式 + 引用
- 接口 `POST /api/public/kb/ask`、`POST /api/admin/kb/reindex`
- 前端 `/ask` 终端对话框（`apps/web/src/pages/Ask.tsx`）
- 已灌库：52 文 / 497 块；生产实测命中问题作答正确

## 生产配置速查
```
# 服务器 .env（apps/server/.env，gitignored）
KB_LLM_BASE_URL=https://api.deepseek.com
KB_LLM_MODEL=deepseek-chat
KB_LLM_API_KEY=<DeepSeek key>

# 重新灌库（发新文后需手动跑；只切块入库、不调 LLM）
ssh openclaw 'docker exec -w /srv/app tenggouwa-app uv run python -c "
import asyncio; from db import async_pg; from modules.kb.service import kb_service
async def m():
    async with async_pg.session() as s: print(await kb_service.reindex(s,\"blog\",force=True))
asyncio.run(m())"'
```

## ⏳ 待办（按价值排序）

### 1. 接嵌入 → 混合检索（最高价值，"能用→好用"）
- [ ] 拿一个专用嵌入 key（**SiliconFlow bge-m3** 1024 维，推荐 / OpenAI 3-small 1536 / Voyage）
- [ ] 迁移 `ALTER TABLE kb_chunk ADD COLUMN embedding vector(<dim>)`（需 postgres 镜像换 `pgvector/pgvector:pg16`，数据卷兼容）
- [ ] `provider.py` 加 `Embedder`（OpenAI 兼容 `/embeddings`，env 配置）；ingest 里对每块嵌入
- [ ] `repository.search_chunks` 改混合：向量召回 + pg_trgm/全文，RRF(k≈60) 融合
- [ ] reindex 一次
- **修的短板**：v0 trigram 对中文语义查询召回不准（如"大模型怎么省显存"问不出来）
- 参考骨架：`Azure-Samples/rag-postgres-openai-python`（RRF SQL 现成）

### 2. 多源接入（验证"blog 只是其一"）
- [ ] `NotesIngester`（读 markdown 文件夹 / Obsidian vault）
- [ ] `CodeIngester`（读 git repo）/ `WebIngester`（抓 URL）
- [ ] `/ask` 支持按源过滤/加权（后端 `sources` 参数已留，前端加个源选择）

### 3. reindex 自动化
- [ ] 发文/改文后 hook 触发增量 reindex（现在纯手动，按 `content_hash` 已支持增量）

### 4. 小优化
- [ ] prerender 静态首页 nav 加 `ask`（目前只 SPA nav 有，爬虫看不到；interactive 页优先级低）
- [ ] 可选：Contextual Retrieval（每块嵌入前用 LLM 加一句上下文，检索失败 -49%）
- [ ] 可选：中文全文分词升级 pg_jieba/zhparser（若精确匹配需求强）

## 已知事实（避免重复踩坑）
- OpenRouter **无 embedding 模型**；`google/gemini-embedding-2` 旁门被 provider ToS 封（403）。DeepSeek 官方也无 embeddings。→ 嵌入必须另找专用端点。
- DeepSeek 官方 `deepseek-chat` 现已指向 deepseek-v4-flash（1M 上下文、便宜）。
