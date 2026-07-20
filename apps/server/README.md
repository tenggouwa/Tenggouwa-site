# tenggouwa-server

Tenggouwa-site 的 FastAPI 后端。Python 3.12 + uv，使用 SQLAlchemy async、Alembic、PostgreSQL 16、
pgvector 和 pg_trgm；生产以 Docker Compose 部署。

## 模块

```text
app/
├── main.py              # FastAPI 入口和 lifespan
├── common/              # 配置、日志、trace context
├── dependencies/        # JWT 与通用依赖
├── middlewares/         # 异常和请求日志
├── db/                  # SQLAlchemy models/session
└── modules/
    ├── auth, totp       # admin 登录与二次验证
    ├── posts, inspirations, search
    ├── analytics, seo
    ├── kb               # ingestion、检索、问答、概念图谱
    ├── agent, memory    # Agent loop、会话、private token、长期记忆
    ├── skills, mcp      # 原生工具、审批、MCP bridge
    ├── pi               # Pi 遥测、产物、探针、exec RPC
    ├── terminal         # Mac Agent / console WSS broker
    └── casino           # 钱包与服务端游戏状态
```

各模块 router 汇总到 `/api`。公开、admin JWT、Agent private token、设备 token 和 WebSocket
各自使用独立前缀/依赖；不要在 service 内用“调用者应该已经鉴权”替代路由边界。

## 本地启动

从仓库根运行：

```bash
pnpm dev:server
```

脚本会检查 Docker、启动本地 PostgreSQL、建立 `.venv`、执行 `uv sync --extra dev`，然后在
`http://127.0.0.1:10095` 启动 API。OpenAPI 文档为 <http://127.0.0.1:10095/docs>。

也可在 `apps/server` 内手动运行：

```bash
./setup_dev_env.sh
source .venv/bin/activate
cd app
python main.py
```

默认 dev admin 为 `dev / dev123`。基础配置位于 `app/config/config.yml`，`config-{ENV}.yml`
覆盖基础值，环境变量最后覆盖；可用 `DOTENV_FILE` 指定 dotenv 文件。

## 环境变量

开发模板见 `.env.sample`，生产模板见 `.env.prod.sample`。主要分组：

| 分组 | 变量 |
| --- | --- |
| 数据与鉴权 | `POSTGRES_DEFAULT_PASSWORD`、`AUTH_JWT_SECRET`、`ADMIN_*_PASSWORD_HASH` |
| Knowledge Base | `KB_LLM_*`、`KB_EMBED_*`、`KB_LLM_REASONER_MODEL` |
| Agent | `AGENT_TOKEN_TTL_MIN`、`AGENT_PI_SANDBOX`、`AGENT_WORKSPACE` |
| Pi | `PI_AGENT_TOKEN` |
| MCP | `MCP_SERVERS`、`MCP_CONNECT_TIMEOUT`、`MCP_LIST_TIMEOUT`、`MCP_CALL_TIMEOUT` |
| SEO | `GSC_SERVICE_ACCOUNT_JSON`/`_FILE`、`GSC_SITE_URL`、`BAIDU_TOKEN`、`BING_WEBMASTER_API_KEY` |
| Tunnel | `CLOUDFLARE_TUNNEL_TOKEN` |

敏感值只放部署环境，不提交 `.env`。`MCP_SERVERS` 是服务端信任白名单；留空表示完全禁用 MCP。

## 数据库与迁移

迁移位于 `alembic/versions/`。生产容器启动时由 `entrypoint.sh` 运行 `alembic upgrade head`；
不要绕过迁移直接修改生产 schema。KB embedding 是 1024 维，生产 PostgreSQL 镜像必须包含 pgvector。

本地数据库：

```bash
docker compose up -d postgres
uv run alembic upgrade head
```

## Lint 与测试

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

真模型测试默认 skip；显式运行：

```bash
RUN_LIVE_TESTS=1 KB_LLM_API_KEY=... \
  uv run pytest tests/test_live_smoke.py tests/test_live_skill_routing.py -q
```

普通 PR CI 不依赖外网和付费模型。修复 Agent 行为问题时要补 ScriptedLLM/golden 回归；只有模型路由
本身无法确定性覆盖的场景才进入 nightly live suite。

## OpenAPI → TypeScript

schema 改动后从仓库根运行：

```bash
pnpm gen:api-types
```

命令直接调用 `main_app.openapi()` 并用 `openapi-typescript` 更新
`packages/api-types/src/openapi.ts`；生成文件与后端改动一起提交。

## 生产部署

```bash
# 仓库根目录
pnpm deploy:server
```

脚本将 `apps/server` rsync 到 `openclaw:~/apps/Tenggouwa-server`，保留远端 `.env`，随后执行
Docker Compose build/up、等待 app healthy，并给成功镜像打 git SHA tag。部署栈是：

- `pgvector/pgvector:pg16`
- FastAPI app
- `cloudflared`（HTTP/2 tunnel）

详细首次部署、日志和回滚方法见 [deploy/README.md](../../deploy/README.md)。当前架构见
[docs/architecture.md](../../docs/architecture.md)。
