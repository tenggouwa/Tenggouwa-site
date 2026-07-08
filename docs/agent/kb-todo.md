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

### 1. 接嵌入 → 混合检索（最高价值，"能用→好用"）✅ 代码完成（PR，待部署）
- [x] 嵌入端点：**OpenRouter `baai/bge-m3`（1024 维）** —— 实测能用/稳定/批量，复用现有 OpenRouter key（走 Parasail，无 gemini 那种 ToS 403）
- [x] 迁移 `20260706_0100`：`ALTER TABLE kb_chunk ADD COLUMN embedding vector(1024)` + hnsw 索引；postgres 镜像换 `pgvector/pgvector:pg16`（prod+dev，数据卷兼容）
- [x] `provider.Embedder`（OpenAI 兼容 `/embeddings`，批量，未配 key 自动降级）；reindex 里对每块嵌入
- [x] `repository.search_chunks` 改混合：向量 `<=>` + pg_trgm 双路 RRF(k=60) 融合；无 qvec 降级纯 trigram
- [x] **已部署 + reindex（2026-07-07）**：postgres 换 pgvector、558 块灌向量、实测"作者是谁"能答了 ✅
- **修的短板**：trigram 对中文语义查询召回不准（如"作者是谁""大模型怎么省显存"）—— 已修

### 2. 多源接入（验证"blog 只是其一"）
- [ ] `NotesIngester`（读 markdown 文件夹 / Obsidian vault）
- [ ] `CodeIngester`（读 git repo）/ `WebIngester`（抓 URL）
- [ ] `/ask` 支持按源过滤/加权（后端 `sources` 参数已留，前端加个源选择）

### 3. reindex 自动化 ✅（每日 cron）
- [x] APScheduler 每天 06:00 UTC+8 增量 reindex blog（`app/modules/kb/scheduler.py`，lifespan 挂载）。
      比 write-hook 更稳：能覆盖 published_at 到期的调度发布（没有写事件）。按 content_hash 增量。
- [ ] 可选：admin 改文后立即触发（即时性，daily 已够用）

### 4. 小优化
- [x] prerender 静态首页 nav 加 `ask`（爬虫/LLM 在静态页也能发现问答入口）
- [ ] 可选：Contextual Retrieval（每块嵌入前用 LLM 加一句上下文，检索失败 -49%）
- [ ] 可选：中文全文分词升级 pg_jieba/zhparser（若精确匹配需求强）

## 已知事实（避免重复踩坑）
- OpenRouter **无 embedding 模型**；`google/gemini-embedding-2` 旁门被 provider ToS 封（403）。DeepSeek 官方也无 embeddings。→ 嵌入必须另找专用端点。
- DeepSeek 官方 `deepseek-chat` 现已指向 deepseek-v4-flash（1M 上下文、便宜）。
