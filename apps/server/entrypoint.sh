#!/usr/bin/env bash
# 容器启动入口：先跑迁移，再起 app
# postgres 健康检查由 docker compose 的 depends_on 保证

set -euo pipefail

echo "[entrypoint] applying database migrations..."
uv run alembic upgrade head

echo "[entrypoint] starting fastapi..."
cd app
exec uv run python main.py
