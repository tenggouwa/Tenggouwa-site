# KB / 概念图谱现状与 Roadmap

> 状态日期：2026-08-03。设计取舍见 [kb-design.md](kb-design.md)，系统位置见
> [当前架构](../architecture.md)。

## 已上线

### Ingestion 与存储

- 源无关 `kb_source / kb_document / kb_chunk` 数据模型，blog 是当前已接入的数据源。
- Markdown 结构感知分块、content hash 增量更新、1024 维 embedding。
- admin 新建/修改文章后即时追平知识库与概念图谱（PR #203）。
- APScheduler 定时增量 reindex 兜底计划发布和漏事件场景。
- PostgreSQL 16 + pgvector，未配置 embedding key 时降级为纯 pg_trgm。

### 检索与回答

- vector + pg_trgm 双路召回，RRF 融合；当前向量通道权重 2×，针对中文口语 query 调优。
- DeepSeek 流式生成、引用回链、工具结果 ok/empty/error 状态。
- `kb_search` 作为 Agent skill；原 `/api/public/kb/ask` 仍保留给主站兼容入口。
- Skill routing golden eval 每晚跑真模型，防“工具存在但模型不选”的行为漂移。

### 概念图谱 / GraphRAG

- 文章概念与关系的两阶段 JSON 抽取、dry-run preview、build 管线。
- 公开 hubs/full/entity 图谱 API 和 `kb_graph` skill。
- Agent Graph 页面为全量力导向图，支持关键词、邻域放大、拖拽固定和系列过滤。
- 独立 Knowledge Base 页面已删除，有用的 overview 信息收敛到 Graph。
- Admin 图谱审核已上线：概念改名、关系下线先形成提案，批准后才影响公开图谱与 Agent GraphRAG；原始关系和审核记录仍保留。

## 生产配置

```dotenv
KB_LLM_BASE_URL=https://api.deepseek.com
KB_LLM_MODEL=deepseek-chat
KB_LLM_API_KEY=<DeepSeek key>

KB_EMBED_BASE_URL=https://openrouter.ai/api/v1
KB_EMBED_MODEL=baai/bge-m3
KB_EMBED_API_KEY=<embedding provider key>
```

强制重建仍可通过 admin reindex API 或容器内 service 调用完成；日常发文不再需要手工 reindex。

## 下一步候选

这些是候选方向，不是已经承诺的排期：

### 多源（有真实受控数据源后再接）

- [x] `NotesIngester`：Markdown/Obsidian vault。设置 `KB_NOTES_DIR` 为受控目录后，通过 admin reindex 的 `source=notes` 增量灌入；未设置时安全空跑，不读取本机任意目录。
- [ ] `CodeIngester`：Git repository；必须固定 repository allowlist、分支和路径规则，不能让公开请求任意拉取代码。
- [ ] `WebIngester`：受控 URL 抓取；复用 SSRF 防护、站点 allowlist、抓取频率和内容版本指纹。
- [ ] 前端按 source 过滤/加权；后端已经保留 sources 参数空间。

### 检索质量（以 eval 结果驱动）

- [x] 建立离线 retrieval eval corpus（`apps/server/tests/fixtures/kb_retrieval_eval.json`）和 nDCG/Recall 指标；新增/改写文章时补同类 query，再用它比较 RRF 权重。
- [ ] 根据 eval 决定是否加入 reranker 或 Contextual Retrieval。
- [ ] 若精确中文匹配成为主要失败模式，再评估 pg_jieba/zhparser。

### 图谱质量与治理

- [x] 为概念改名和错误关系建立可审阅/修正机制：Admin 的提案必须经批准才生效；下线边不再进入公开图谱或 Agent 查询，审计记录与原始溯源保留。
- [x] 建立 graph extraction golden fixture，防 provider 输出变化导致静默丢关系。
- [ ] 别名合并：等出现跨文档重复概念的真实样本后，再以保留溯源的方式设计合并规则；不在无样本时猜测自动合并。
- [ ] 数据量明显增长后再评估分层加载或图谱裁剪；当前全图方案保持简单。

### 当前优先级

1. 先维护 retrieval / graph golden fixture，所有线上问题先沉淀为可复现样本。
2. 当 Notes 有正式受控目录和真实内容后，补来源筛选与 source 级检索权重。
3. 有明确业务 repository 或 URL 清单后，再分别启用 CodeIngester / WebIngester；二者不共享“任意本机目录或任意 URL”的权限。

## 已知约束

- embedding 必须来自单独的 OpenAI-compatible endpoint；DeepSeek 官方生成端点不提供 embedding。
- 图谱抽取依赖模型 JSON 输出，因此比普通 chunk ingestion 更需要可观测指纹和回归 fixture。
- Notes source 已可部署但生产默认未配置目录，因而当前线上内容仍只有 blog；数据模型“支持多源”不等于已接入任意本机目录。
- `deepseek-chat` 的具体后端版本可能由供应商调整；代码只依赖 OpenAI-compatible 行为，不在文档中绑定营销版本名。
