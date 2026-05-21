#!/usr/bin/env bash
# 把 apps/server 同步到阿里云（ssh openclaw）并重启服务。
#
# 远端约定：
#   - 部署目录：~/apps/Tenggouwa-server/
#   - systemd user unit：tenggouwa-server.service（见 deploy/systemd/）
#   - 远端已装 uv（curl -LsSf https://astral.sh/uv/install.sh | sh）
#
# 用法：
#   pnpm deploy:server
#   REMOTE=openclaw REMOTE_PATH='~/apps/Tenggouwa-server' pnpm deploy:server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-openclaw}"
REMOTE_PATH="${REMOTE_PATH:-~/apps/Tenggouwa-server}"
SERVICE="${SERVICE:-tenggouwa-server.service}"

echo "==> rsync apps/server → $REMOTE:$REMOTE_PATH"
# shellcheck disable=SC2029
ssh "$REMOTE" "mkdir -p $REMOTE_PATH"

rsync -avz --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.ruff_cache' \
  --exclude '.pytest_cache' \
  --exclude 'logs/' \
  --exclude '.env' \
  "$ROOT/apps/server/" "$REMOTE:$REMOTE_PATH/"

echo "==> 远端 uv sync + 重启服务"
# shellcheck disable=SC2029
ssh "$REMOTE" bash -lc "'
  set -e
  cd $REMOTE_PATH
  uv sync --all-extras
  systemctl --user daemon-reload
  systemctl --user restart $SERVICE
  systemctl --user status --no-pager $SERVICE | head -n 12
'"

echo "==> 部署完成。"
