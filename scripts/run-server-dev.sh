#!/usr/bin/env bash
# 一键启动后端 dev 进程，从仓库根目录调用：pnpm dev:server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/server"

if [ ! -d ".venv" ]; then
  echo "==> 首次运行，执行 setup_dev_env.sh"
  ./setup_dev_env.sh
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# config_manager 依赖 ENV 环境变量。优先用调用方已设置的值，
# 没有就读 apps/server/.env，再没有就兜底 dev。
if [ -f ".env" ]; then
  export DOTENV_FILE="$(pwd)/.env"
fi
export ENV="${ENV:-dev}"

cd app
exec python main.py
