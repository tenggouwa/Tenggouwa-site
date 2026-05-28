# tenggouwa-server

Tenggouwa-site 的后端，基于 [`Python-cli`](../../../Python-cli/) 脚手架。

## 模块

```
app/
├── main.py                 # FastAPI 入口（uvicorn dev / gunicorn prod）
├── common/                 # 配置 / 日志 / trace context
├── middlewares/            # 全局异常 + 路由日志
├── dependencies/           # JWT 鉴权 / DetailedHTTPException
├── db/                     # SQLAlchemy 2 async session
└── modules/
    ├── __init__.py         # 聚合所有路由到 /api 前缀下
    ├── common_schema.py    # ResponseModel[T]
    ├── auth/               # /api/admin/auth/login（两阶段：密码 → TOTP）
    ├── totp/               # /api/admin/totp 启用 / 关闭 / 7d 信任 cookie
    ├── posts/              # /api/public/posts, /api/admin/posts
    ├── search/             # /api/public/search（PG pg_trgm 全文检索）
    ├── inspirations/       # /api/public/inspirations, /api/admin/inspirations
    ├── analytics/          # /api/public/track 埋点 + /api/admin/analytics 看板
    ├── seo/                # Web Vitals + Google Search Console + 定时调度
    └── terminal/           # /api/console/* + /api/agent/* + WSS 网关
```

迁移：`alembic/versions/` 下按时间戳排序。

## 本地启动

```bash
./setup_dev_env.sh        # 首次：建 .venv / uv sync
source .venv/bin/activate
cd app
python main.py            # http://127.0.0.1:10095
```

OpenAPI 文档：<http://127.0.0.1:10095/docs>

默认 dev 账号：`dev / dev123`（在 `app/config/config.yml`）。

## 配置

`app/config/config.yml` 是基础配置，`config-{ENV}.yml` 做覆盖，环境变量 final 合并。

生产关键覆盖（`config-prod.yml`）：

- `auth.jwt_secret` — 长随机串
- `auth.admins[].password_hash` — bcrypt 哈希，生成方式：

  ```bash
  python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"
  ```

## Lint / 测试

CI（`.github/workflows/ci.yml`）在每个 PR 跑下面这套，本地等价命令：

```bash
cd apps/server

# Lint + 格式（CI 用同一份 pyproject.toml）
uv run ruff check .
uv run ruff format --check .

# 单元测试（asyncio_mode=auto，pythonpath=app）
uv run pytest
```

仓库根 `lefthook.yml` 的 `pre-commit` 钩子会自动对 staged `*.py` 跑 `ruff format` + `ruff check --fix`；`pre-push` 跑全量 ruff + 全 monorepo typecheck。

## OpenAPI → 前端类型

后端 schema 变了之后，从仓库根跑：

```bash
pnpm gen:api-types
```

会调 `scripts/dump_openapi.py`（直接 `import main_app; main_app.openapi()`，不启服务、不连库），再通过 `openapi-typescript` 写出 `packages/api-types/src/openapi.ts`。然后 commit 生成的 `.ts` 文件。

## 部署

仓库根目录跑 `pnpm deploy:server`，会把代码 rsync 到 `openclaw:~/apps/Tenggouwa-server`，
然后远端 `uv sync` 并重启 systemd 服务。
