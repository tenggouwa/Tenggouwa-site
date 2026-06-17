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
#
# 部署后会**轮询 app 健康**：起不来直接 loud 失败 + 打印日志 + 给回滚命令，
# 不再"compose 一启动就当成功"。每次成功部署给镜像打 git-sha 标签，便于回滚。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-openclaw}"
REMOTE_PATH="${REMOTE_PATH:-~/apps/Tenggouwa-server}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

GITSHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
git -C "$ROOT" diff --quiet 2>/dev/null || GITSHA="${GITSHA}-dirty"

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
  --exclude '.env.umami' \
  "$ROOT/apps/server/" "$REMOTE:$REMOTE_PATH/"

echo "==> 远端构建 + 健康校验（GITSHA=$GITSHA）"
ssh "$REMOTE" bash -l -s -- "$REMOTE_PATH" "$COMPOSE_FILE" "$GITSHA" <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_PATH="$1"; COMPOSE_FILE="$2"; GITSHA="$3"
cd "$REMOTE_PATH"
[ -f .env ] || { echo "!! 远端缺少 .env，请先 cp .env.prod.sample .env 并填好 secret"; exit 1; }

# 留一手回滚：把当前 latest 存成 :rollback（首次没有镜像就跳过）
if docker image inspect tenggouwa-server:latest >/dev/null 2>&1; then
  docker tag tenggouwa-server:latest tenggouwa-server:rollback
fi

DOCKER_BUILDKIT=1 docker compose -f "$COMPOSE_FILE" --env-file .env up -d --build

echo "--- 等 app 变 healthy（最多 120s）---"
ok=
for i in $(seq 1 24); do
  s="$(docker inspect -f '{{.State.Health.Status}}' tenggouwa-app 2>/dev/null || echo none)"
  echo "  [$i] app: $s"
  if [ "$s" = healthy ]; then ok=1; break; fi
  sleep 5
done

if [ -z "$ok" ]; then
  echo
  echo "!!!!!! 部署失败：app 未在 120s 内 healthy。最近日志： !!!!!!"
  docker compose -f "$COMPOSE_FILE" logs --tail=40 app || true
  echo
  echo ">> 回滚到上一个镜像："
  echo "   ssh $(hostname) 'cd $REMOTE_PATH && docker tag tenggouwa-server:rollback tenggouwa-server:latest && docker compose -f $COMPOSE_FILE --env-file .env up -d app'"
  exit 1
fi

# 健康：给本次镜像打 git-sha 标签留档（回滚到具体版本用）
docker tag tenggouwa-server:latest "tenggouwa-server:$GITSHA" || true
echo "--- 容器状态 ---"
docker compose -f "$COMPOSE_FILE" ps
echo "✓ app healthy（镜像已标记 tenggouwa-server:$GITSHA）"
REMOTE_SCRIPT

echo "==> 部署完成。日志：ssh $REMOTE 'cd $REMOTE_PATH && docker compose -f $COMPOSE_FILE logs -f app'"
