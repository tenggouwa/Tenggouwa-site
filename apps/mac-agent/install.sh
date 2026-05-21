#!/usr/bin/env bash
# 一键安装 Mac 终端 agent + launchd 常驻
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "这个脚本只在 macOS 上跑"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.tenggouwa-agent"
PYTHON_BIN="$(command -v python3.12 || command -v python3.11 || command -v python3)"

if [ -z "$PYTHON_BIN" ]; then
  echo "找不到 python3。先装 Python 3.11+"
  exit 1
fi
echo "==> 用 Python: $PYTHON_BIN"

mkdir -p "$INSTALL_DIR"

echo "==> 拷贝 agent 代码到 $INSTALL_DIR"
cp -R "$SCRIPT_DIR/agent" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/pyproject.toml" "$INSTALL_DIR/"

echo "==> 建 venv + 装依赖"
"$PYTHON_BIN" -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/.venv/bin/pip" install --quiet 'websockets==13.1' 'ptyprocess==0.7.0'

# 配置交互
if [ ! -f "$INSTALL_DIR/config.toml" ]; then
  echo
  echo "==> 配置 agent_token / server_url"
  read -r -p "粘贴 agent_token (admin 后台 → 站点设置 → 新建 agent 拿到的一次性 token): " AGENT_TOKEN
  DEFAULT_URL="wss://api.tenggouwa.com/api/agent/ws"
  read -r -p "server_url [$DEFAULT_URL]: " SERVER_URL
  SERVER_URL="${SERVER_URL:-$DEFAULT_URL}"
  cat > "$INSTALL_DIR/config.toml" <<EOF
agent_token = "$AGENT_TOKEN"
server_url  = "$SERVER_URL"
# 可选：覆盖默认 shell / TERM
# shell = "/bin/zsh"
# term  = "xterm-256color"
EOF
  chmod 600 "$INSTALL_DIR/config.toml"
  echo "==> 写入 $INSTALL_DIR/config.toml"
else
  echo "==> 配置已存在，跳过 ($INSTALL_DIR/config.toml)"
fi

# 写 launchd plist
PLIST="$HOME/Library/LaunchAgents/com.tenggouwa.agent.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tenggouwa.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/.venv/bin/python</string>
    <string>-m</string><string>agent.main</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>NetworkState</key><true/>
  </dict>
  <key>StandardOutPath</key><string>$INSTALL_DIR/stdout.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>LOG_LEVEL</key><string>INFO</string></dict>
</dict>
</plist>
EOF

echo "==> 装 launchd: $PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "==> 已加载。查看日志：tail -f $INSTALL_DIR/stderr.log"
echo "==> 卸载：launchctl unload $PLIST"
