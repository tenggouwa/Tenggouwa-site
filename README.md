<div align="center">

```text
 _
| |_ ___ _ __   __ _  __ _  ___  _   ___      ____ _
| __/ _ \ '_ \ / _` |/ _` |/ _ \| | | \ \ /\ / / _` |
| ||  __/ | | | (_| | (_| | (_) | |_| |\ V  V / (_| |
 \__\___|_| |_|\__, |\__, |\___/ \__,_| \_/\_/ \__,_|
               |___/ |___/
```

**Tenggouwa 的个人网站与 AI Agent 实验平台**

[![Deploy Pages](https://github.com/tenggouwa/Tenggouwa-site/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/tenggouwa/Tenggouwa-site/actions/workflows/deploy-pages.yml)
[![Site](https://img.shields.io/website?url=https%3A%2F%2Ftenggouwa.com&label=web&style=flat-square)](https://tenggouwa.com/)
[![API](https://img.shields.io/website?url=https%3A%2F%2Fapi.tenggouwa.com%2Fhealth%2Fcheck&label=api&style=flat-square)](https://api.tenggouwa.com/health/check)

[**web**](https://tenggouwa.com/) · [**agent**](https://tenggouwa.com/agent/) ·
[**casino**](https://tenggouwa.com/casino/) · [**admin**](https://tenggouwa.com/admin/)

</div>

---

这是一个 pnpm + uv 管理的全栈 monorepo。公开网站、管理后台、Agent 平台和 Casino
构建为静态 SPA；FastAPI 后端与 pgvector PostgreSQL 部署在阿里云，通过 Cloudflare
Tunnel 暴露 API。Agent 的高危文件、shell 和 git 操作在树莓派的 `bwrap` 沙箱中执行。

## 现在有什么

- **个人网站**：Markdown 文章、系列、灵感、全文搜索、实验室、Pi 状态页、SEO 静态预渲染。
- **管理后台**：文章与灵感管理、访问分析、Web Vitals、Search Console、远程终端和站点设置。
- **AI Agent**：流式多轮对话、公开/私有通道、TOTP 解锁、会话续聊、长期记忆、工具审批、深度思考。
- **知识系统**：博客自动入库、pgvector + pg_trgm 混合检索、RRF、引用、概念抽取、GraphRAG 和力导向图谱。
- **执行能力**：网页搜索/抓取、文件读写与编辑、shell、git、只读子代理、并行工具调用和 MCP 扩展。
- **隔离节点**：Pi Agent 主动轮询任务，在默认无网的 `bwrap` workspace 内执行命令；Mac Agent 提供远程 PTY。
- **工程保障**：前后端确定性测试、provider golden、nightly 真模型 smoke、PR CI、Lighthouse、Dependabot 和 lefthook。

## Workspace

| 路径 | 用途 | 部署路径 |
| --- | --- | --- |
| `apps/web` | 公开网站 | `/` |
| `apps/admin` | 管理后台 | `/admin/` |
| `apps/agent` | 独立 Agent UI | `/agent/` |
| `apps/casino` | 概率与赌场游戏实验 | `/casino/` |
| `apps/server` | FastAPI API、Agent/KB/终端网关 | `api.tenggouwa.com` |
| `apps/pi-agent` | Pi 遥测、探针、产物与沙箱执行 daemon | Raspberry Pi systemd |
| `apps/mac-agent` | Mac 远程 PTY daemon | macOS launchd |
| `packages/api-types` | OpenAPI 自动生成的共享 TS 类型 | workspace package |
| `content` | 文章和 About 内容 | 构建时预渲染 |

当前架构、信任边界和请求链路见 [docs/architecture.md](docs/architecture.md)。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web | React 19、React Router 7、TypeScript 5.9、Vite 5 |
| UI | Tailwind CSS 3、Arco Design；Casino 使用 Three.js / React Three Fiber |
| API | Python 3.12、FastAPI、SQLAlchemy async、Alembic |
| 数据 | PostgreSQL 16、pgvector、pg_trgm |
| Agent | DeepSeek chat/reasoner、OpenAI-compatible provider、MCP 1.x |
| 节点 | Python daemon、WSS/HTTPS outbound、Bubblewrap |
| 发布 | GitHub Actions、GitHub Pages、Cloudflare Pages/Tunnel、Docker Compose |

## 本地开发

前置：Node.js 20+、pnpm 9.12、Python 3.12、uv、Git 2.31+。

```bash
pnpm install

# 前端
pnpm dev:web       # Vite 默认端口 5173
pnpm dev:admin     # 5174
pnpm dev:agent     # 5176

# 后端：先启动本地 PostgreSQL；首次运行会创建 venv、同步依赖
docker compose -f apps/server/docker-compose.yml up -d postgres
pnpm dev:server    # http://127.0.0.1:10095
```

Casino 暂无根级快捷命令：

```bash
pnpm --filter @tenggouwa/casino dev
```

开发环境变量从各应用的 `.env.sample` 开始；生产变量见
[apps/server/.env.prod.sample](apps/server/.env.prod.sample)。

## 验证

```bash
# 全 workspace TypeScript typecheck
pnpm lint

# 普通 PR CI 的前端测试
pnpm --filter @tenggouwa/web test
pnpm --filter @tenggouwa/agent test

# 后端门禁
cd apps/server
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

涉及模型行为的改动还应运行受 `RUN_LIVE_TESTS=1` 和 `KB_LLM_API_KEY` 控制的 live tests；
GitHub Actions 每晚也会执行同一套 smoke/eval。

## 构建与部署

```bash
# GitHub Pages 子路径产物 pages-dist/，并给镜像站加 noindex
pnpm build:pages

# 根域名产物 cf-dist/
pnpm build:cf

# 后端 rsync + Docker Compose build + health check
pnpm deploy:server
```

`build-pages.sh` 一次构建 web/admin/agent/casino，并生成文章静态 HTML、sitemap、robots、feed、
Casino SEO 页面和 OG 图片。`main` 的相关改动由 `deploy-pages.yml` 自动发布；后端仍需手动部署。

完整步骤见 [deploy/README.md](deploy/README.md) 和
[docs/ops/deploy-tenggouwa-com.md](docs/ops/deploy-tenggouwa-com.md)。

## OpenAPI 类型

修改 FastAPI schema 后运行：

```bash
pnpm gen:api-types
```

生成结果位于 `packages/api-types/src/openapi.ts`，需要与 schema 改动一起提交。前端优先通过
`apps/web/src/lib/apiTypes.ts` 使用这些类型，不手抄响应模型。

## 协作流程

所有改动走 feature branch + PR + squash merge，不直接 push `main`：

1. 在工作区完成修改和本地验证，先让用户查看 diff。
2. 从 `origin/main` 创建 feature branch。
3. commit、push，创建包含 Summary / Why / Test plan 的 PR。
4. 等 `ci.yml` 通过后 squash merge，并同步本地 `main`。

完整代码规范和视觉约束见 [AGENTS.md](AGENTS.md)。

## 文档导航

- [当前系统架构](docs/architecture.md)
- [Agent 当前能力与使用](apps/agent/README.md)
- [Agent 分阶段实现记录](docs/agent/agent-roadmap.md)
- [知识库现状与待办](docs/agent/kb-todo.md)
- [后端开发说明](apps/server/README.md)
- [Pi Agent](apps/pi-agent/README.md) / [Mac Agent](apps/mac-agent/README.md)
- [生产部署](deploy/README.md)

`docs/agent/*-design.md` 和 `agent-architecture-research.md` 记录的是设计发生时的研究与取舍；
查看当前实现时，以 `docs/architecture.md`、应用 README 和代码为准。
