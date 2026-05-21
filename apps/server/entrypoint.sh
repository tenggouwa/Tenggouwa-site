#!/usr/bin/env bash
# 容器启动入口：先跑迁移，再起 app。
# postgres 健康检查由 docker compose 的 depends_on 保证。
# 全程 cwd=/srv/app，让 logging_config.yml 的 ../logs/ 落到 /srv/logs/（在 Dockerfile 里建）。

set -euo pipefail

cd app

echo "[entrypoint] applying database migrations..."
uv run alembic -c /srv/alembic.ini upgrade head

echo "[entrypoint] starting fastapi..."
exec uv run python main.py
