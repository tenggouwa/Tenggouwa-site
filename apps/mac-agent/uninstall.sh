#!/usr/bin/env bash
# 一键卸载 Mac 终端 agent：停 launchd、删 plist、删本地目录、收尸游离进程
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "这个脚本只在 macOS 上跑"
  exit 1
fi

INSTALL_DIR="$HOME/.tenggouwa-agent"
PLIST="$HOME/Library/LaunchAgents/com.tenggouwa.agent.plist"

echo "==> 停 launchd + 删 plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm "$PLIST"
  echo "   removed: $PLIST"
else
  echo "   skip: $PLIST 不存在"
fi

echo "==> 收尸游离 agent.main 进程（手动测试时留下的）"
if pgrep -f "agent.main" >/dev/null 2>&1; then
  pkill -f "agent.main" || true
  echo "   killed"
else
  echo "   skip: 没有 agent 进程在跑"
fi

echo "==> 删本地目录"
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "   removed: $INSTALL_DIR"
else
  echo "   skip: $INSTALL_DIR 不存在"
fi

cat <<'NOTE'

==> 完成。
   提醒：还要在 admin 后台 → 终端 → 把对应 agent 撤销
   （否则 agent_token 还在 PG 里，理论上还能被滥用）
NOTE
