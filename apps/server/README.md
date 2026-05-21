# tenggouwa-server

Tenggouwa-site 的后端，基于 [`Python-cli`](../../../Python-cli/) 脚手架。

## 模块

```
app/
├── main.py                 # FastAPI 入口（uvicorn dev / gunicorn prod）
├── common/                 # 配置 / 日志 / trace context
├── middlewares/            # 全局异常 + 路由日志
├── dependencies/           # JWT 鉴权 / DetailedHTTPException
├── db/                     # 异步 MySQL（按需启用）
└── modules/
    ├── __init__.py         # 聚合所有路由到 /api 前缀下
    ├── common_schema.py    # ResponseModel
    ├── auth/               # /api/admin/auth/login
    ├── posts/              # /api/public/posts, /api/admin/posts
    └── inspirations/       # /api/public/inspirations, /api/admin/inspirations
```

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

## 部署

仓库根目录跑 `pnpm deploy:server`，会把代码 rsync 到 `openclaw:~/apps/Tenggouwa-server`，
然后远端 `uv sync` 并重启 systemd 服务。
