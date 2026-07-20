# 当前系统架构

> 状态日期：2026-07-20。本文描述已经落地的系统；历史设计过程见 `docs/agent/` 下的 design 和 research 文档。

## 总览

```text
Browser
  ├── tenggouwa.com/          web
  ├── tenggouwa.com/admin/    admin
  ├── tenggouwa.com/agent/    agent
  └── tenggouwa.com/casino/   casino
           │ HTTPS / SSE / WSS
           ▼
Cloudflare Pages + Cloudflare Tunnel
           │
           ▼
Aliyun Docker Compose
  ├── FastAPI app
  ├── PostgreSQL 16 + pgvector
  └── cloudflared
           │ outbound polling / WSS
           ├── Raspberry Pi: telemetry + bwrap sandbox
           └── Mac: remote PTY daemon
```

GitHub Pages 同时维护一份挂在仓库子路径下的 `noindex` 镜像；`tenggouwa.com` 是 canonical 站点。

## 前端应用

四个 SPA 共享 React、TypeScript、Vite 和 terminal/CRT 视觉语言，但按用途独立构建：

- `web`：内容消费入口。公开 API 失败时显示对应空态，不持有 admin 凭据。
- `admin`：JWT + TOTP 管理面，维护内容、SEO、分析和远程终端。
- `agent`：Agent 对话、概念图谱和 skill 目录。公开通道只获得 readonly 能力；私有通道解锁后才能使用 owner 数据和高危工具。
- `casino`：独立游戏实验。部分游戏逻辑/钱包状态经后端 API 持久化。

`scripts/build-pages.sh` 根据 `PAGES_TARGET` 生成两种产物：

| 目标 | base | 目录 | 搜索引擎策略 |
| --- | --- | --- | --- |
| `ghpages` | `/Tenggouwa-site/...` | `pages-dist` | 镜像站 `noindex` |
| `root` | `/`、`/admin/`、`/agent/`、`/casino/` | `cf-dist` | canonical，可索引 |

## 后端模块

`apps/server/app/modules` 按业务拆 router/service/repository/schema，统一挂到 `/api`：

| 模块 | 职责 |
| --- | --- |
| `auth` / `totp` | admin 登录、TOTP 与 trust cookie |
| `posts` / `inspirations` / `search` | 内容管理和公开检索 |
| `analytics` / `seo` | 埋点、Web Vitals、GSC 与搜索引擎状态 |
| `kb` | ingestion、混合检索、问答与概念图谱 |
| `agent` / `memory` | 对话循环、会话、private token 与长期记忆 |
| `skills` / `mcp` | 原生工具、权限、审批和 MCP bridge |
| `pi` | Pi 遥测、探针、每日产物与 exec RPC |
| `terminal` | Mac Agent 注册、PTY broker、console 解锁与 WSS |
| `casino` | 服务端钱包与需要权威状态的游戏逻辑 |

Alembic 在容器启动时执行迁移。PostgreSQL 同时使用关系数据、`pg_trgm` 和 pgvector，不另设向量数据库。

## Agent 请求链路

1. 公开请求进入 `/api/public/agent/chat`；私有请求先通过 TOTP 换取 owner-scoped `agent_token`，再进入 `/api/agent/chat`。
2. Agent 从持久化会话、owner 长期记忆和稳定 system/tool prefix 组装上下文。
3. LLM 通过流式 tool-calling 循环规划并调用工具；工具结果有统一的 ok/empty/error 语义和长度上限。
4. readonly 工具可自动执行；write/exec 工具生成审批请求，本轮暂停，用户批准后续跑。
5. 文件、shell 和 git 请求经后端 Pi broker，由 Pi Agent 长轮询取得，在 `bwrap` workspace 中执行并流式回传。
6. assistant/tool 消息成对落库，可恢复会话；取消或断连显式回滚未完成状态。

### 原生能力

- 知识：`kb_search`、`kb_graph`
- Web：`web_search`、`web_fetch`
- 控制：`update_plan`、`ask_user`
- 执行：`file_list/read/write/edit`、`shell_exec`、`git`
- 编排：`run_subagent`；只有显式标记安全的纯网络 readonly 工具可同批并发
- 个性化：`remember`、`forget`，owner 维度跨会话

MCP 仅从服务端 `MCP_SERVERS` 白名单加载，默认关闭。支持 stdio/streamable HTTP、连接与调用超时、
server 失败隔离、确定性排序和 schema 渐进披露。MCP 工具只出现在私有通道；未显式 `auto` 的 server 工具需审批。

## 知识库链路

```text
post write / scheduled reindex
  → Markdown structure-aware chunks
  → bge-m3 embedding + pg_trgm text index
  → vector/text 双路召回
  → weighted RRF
  → LLM answer + clickable citations
```

文章新增或修改会即时追平 KB 与概念图谱，scheduler 仍负责兜底和计划发布时间。概念抽取与关系构建落在同一 PostgreSQL，
供 `kb_graph` 和 Agent Graph 页面使用。

## 信任边界

- 浏览器公开通道：只能调用公开、readonly skill。
- Agent 私有通道：TOTP 解锁、owner 隔离、短期 token，可列出/删除自己的会话和记忆。
- write/exec：默认逐项审批；长期记忆写入免批，但仍串行并限制在 owner 内。
- Pi：仅主动 outbound；daemon secret 经 `bwrap --clearenv` 隔离，系统只读、workspace 可写、默认无网络、带超时和输出上限。
- Mac：仅主动 outbound WSS；服务端保存 token hash，PTY 会话有审计和单 active session 约束。
- MCP：只连接部署者配置的白名单 server；单 server 故障不会阻塞 FastAPI 启动。

## 数据与持久化

- `pg_data`：全部业务、Agent、KB、图谱、遥测和审计数据。
- `agent_ws`：后端挂载的 Agent workspace；Pi 执行使用 Pi 侧配置的 jailed workspace。
- 前端构建产物：GitHub Actions artifact + GitHub/Cloudflare Pages。
- Secrets：生产 `.env`、GitHub Actions secrets/variables、Mac/Pi 本机配置；均不进仓库。

## 测试与发布

- PR CI：web/agent Vitest、四个 SPA typecheck/build、后端 ruff/pytest。
- Nightly：真 DeepSeek smoke 与 skill-routing golden eval，不进入普通 PR 门禁。
- Pages：相关路径 push `main` 自动发布；每 6 小时重建动态发布内容，定时任务通过 hook 同步触发 Cloudflare Pages。
- 后端：`pnpm deploy:server` rsync 后 Docker Compose 重建，等待 health check；成功镜像保留 git SHA tag，失败输出回滚命令。

## 继续阅读

- Agent 使用与配置：[apps/agent/README.md](../apps/agent/README.md)
- 后端开发：[apps/server/README.md](../apps/server/README.md)
- 生产部署：[deploy/README.md](../deploy/README.md)
- Agent 实现记录：[agent/agent-roadmap.md](agent/agent-roadmap.md)
- KB 待办：[agent/kb-todo.md](agent/kb-todo.md)
