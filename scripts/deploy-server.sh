#!/usr/bin/env bash
# 把 apps/server 同步到阿里云并用 docker compose 启动 / 升级。
#
# 远端约定：
#   - 装了 docker + compose plugin
#   - 部署目录：~/apps/Tenggouwa-server/
#   - 第一次部署前，远端先放一份 .env（从 .env.prod.sample 复制并填好 secret）
#
# 用法：
#   pnpm deploy:server
#   REMOTE=openclaw REMOTE_PATH='~/apps/Tenggouwa-server' pnpm deploy:server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-openclaw}"
REMOTE_PATH="${REMOTE_PATH:-~/apps/Tenggouwa-server}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "==> 确保远端目录存在"
ssh "$REMOTE" "mkdir -p $REMOTE_PATH"

echo "==> rsync apps/server → $REMOTE:$REMOTE_PATH"
rsync -avz --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.ruff_cache' \
  --exclude '.pytest_cache' \
  --exclude 'logs/' \
  --exclude '.env' \
  "$ROOT/apps/server/" "$REMOTE:$REMOTE_PATH/"

echo "==> 远端 docker compose 拉起 / 重建"
ssh "$REMOTE" bash -lc "'
  set -e
  cd $REMOTE_PATH
  if [ ! -f .env ]; then
    echo \"!! 远端缺少 .env，请先 cp .env.prod.sample .env 并填好 secret\"
    exit 1
  fi
  docker compose -f $COMPOSE_FILE --env-file .env up -d --build
  echo
  echo \"--- 容器状态 ---\"
  docker compose -f $COMPOSE_FILE ps
'"

echo "==> 部署完成。看日志：ssh $REMOTE 'cd $REMOTE_PATH && docker compose -f $COMPOSE_FILE logs -f app'"
