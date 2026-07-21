# Findings: 全项目文档同步

## Requirements
- 用户要求更新整个项目的文档。
- 中文为主，英文技术名词保留。
- 内容必须以当前代码和近期合并记录为准。
- 不进行 commit、push 或 PR，先交付工作区 diff。

## Research Findings
- 仓库当前 `main` 与 `origin/main` 同步，最新提交为 PR #208。
- 2026-07-08 至 2026-07-19 的主要开发方向是 Agent 内核、测试、安全审批、Pi 沙箱、MCP、子代理、知识图谱和长期记忆。
- 顶层 README 仍以 web/admin/server/mac-agent 为主，遗漏 apps/agent、apps/pi-agent、apps/casino 等已存在应用，路线图也明显落后。
- `docs/agent/agent-roadmap.md` 的顶部收官说明停在 PR #178，但后续已推进到 #208。
- `docs/agent/kb-todo.md` 中 admin 写入后即时追平仍列为待办，但 PR #203 已完成。
- 正式维护文档共分四类：顶层入口（README/CLAUDE）、应用说明（server/mac-agent/pi-agent）、运维说明（deploy/docs/ops）、Agent/KB 设计与 roadmap；`content/posts/**` 是站点内容，不属于工程文档同步范围。
- Pages 构建实际包含 web、admin、casino、agent 四个 SPA；支持 `ghpages` 子路径镜像和 `root` canonical 构建，并生成静态文章、casino SEO 壳、sitemap、robots、feed、OG。
- CI 实际使用 React 19 / React Router 7，而 README 仍写 React 18；普通 CI 会跑 web/agent Vitest、四个前端 build、后端 ruff/pytest。
- 后端生产部署已是 Docker Compose：pgvector PostgreSQL + FastAPI app + cloudflared，不再是 server README 所写的远端 `uv sync` + systemd。
- `apps/server/.env.prod.sample` 尚未记录 Agent private/sandbox/MCP/Umami 等代码支持的全部可选环境变量，需要从代码继续核对后决定是否补齐。
- Pi Agent 除遥测外已承担 Agent shell 沙箱；其 README 仍把 shell exec 描述为 D2 阶段性能力，但核心内容基本准确。
- 当前前端实际为 React 19.2 / React Router 7.15 / TypeScript 5.9 / Vite 5；web/admin 仍用 Arco + Tailwind，agent 不依赖 Arco，casino 使用 React Three Fiber/Three.js。
- `apps/agent` 当前公开路由为 ask/graph/skills；私有模式支持 TOTP 解锁、会话续聊、长期记忆管理、高危工具审批、Pi 文件/shell/git 能力。
- 原生 skill 当前 15 个：KB 检索、plan、web fetch/search、ask_user、4 个文件工具、shell、subagent、git、KB graph、remember/forget；高危原生工具仅在私有通道暴露并走审批，remember/forget 免批但串行。
- MCP 从 `MCP_SERVERS` JSON 白名单读取，支持 stdio/http、按 server 设 `auto`、连接/list/call 超时、失败隔离和工具 schema 渐进披露。
- 后端模块除旧 README 所列外，还有 agent、casino、kb、mcp、memory、pi、skills；公开/私有/admin/agent 接口边界由各 router 分开维护。
- Pi Agent 是 Python >=3.9 零三方依赖；Mac Agent 是 Python >=3.11，使用 websockets + ptyprocess。
- 最终复核 Vite 端口：web 5173、admin 5174、casino 5175、agent 5176；`pnpm dev:server` 不负责启动 PostgreSQL。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先全量列出文档，再按事实源逐类核对 | “整个项目”不能只更新 README |
| 区分现状文档、操作手册、设计记录、roadmap | 不同类型文档的更新策略不同 |
| README 保持入口性质，细节下沉到 docs | 避免顶层文档再次因复制大量细节快速过期 |
| 不修改 `content/posts/**` 和 `content/about.md` | 它们是发布内容，不是工程说明 |
| 历史设计稿加状态提示/链接，而非全面改写 | 保留决策轨迹，同时引导读者查看当前架构 |
| 新增 `docs/architecture.md` 和缺失的应用 README | 给当前实现一个稳定事实入口，避免读者从过期 roadmap 反推架构 |
| 将 `deploy/postgres.md` 明确标为 legacy | 当前生产已由 Docker Compose 管理 pgvector PostgreSQL，旧宿主机方案仍可作为备选 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
- `README.md`
- `AGENTS.md`
- `package.json`
- `docs/agent/*`
- `deploy/*`
- `.github/workflows/*`
- 各 app 的 package/README/配置与后端模块

## Visual/Browser Findings
- 本任务不需要浏览器或视觉检查。
