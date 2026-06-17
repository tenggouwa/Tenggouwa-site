#!/usr/bin/env bash
# 在树莓派上把 pi-agent 装成 systemd 服务（开机自启 + 崩溃自拉起）。
# 纯 stdlib，不建 venv，直接用系统 python3。
#
#   cd apps/pi-agent && ./install.sh
#
# 会向你询问后端地址和上报 token（token 要与后端 PI_AGENT_TOKEN 一致）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="$(id -un)"
ENV_FILE="/etc/tenggouwa-pi-agent.env"
UNIT_FILE="/etc/systemd/system/tenggouwa-pi-agent.service"

command -v python3 >/dev/null || { echo "需要 python3"; exit 1; }

read -rp "后端地址 [https://api.tenggouwa.com]: " SERVER_URL
SERVER_URL="${SERVER_URL:-https://api.tenggouwa.com}"
read -rp "上报 token (PI_AGENT_TOKEN): " AGENT_TOKEN
[ -n "$AGENT_TOKEN" ] || { echo "token 不能为空"; exit 1; }
read -rp "上报间隔秒 [30]: " INTERVAL
INTERVAL="${INTERVAL:-30}"

echo "▸ 写入 $ENV_FILE"
sudo tee "$ENV_FILE" >/dev/null <<EOF
PI_AGENT_SERVER_URL=$SERVER_URL
PI_AGENT_TOKEN=$AGENT_TOKEN
PI_AGENT_INTERVAL=$INTERVAL
EOF
sudo chmod 600 "$ENV_FILE"

echo "▸ 写入 $UNIT_FILE"
sudo tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=tenggouwa pi-agent (system telemetry reporter)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$HERE
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/python3 -m agent.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "▸ 启用并启动服务"
sudo systemctl daemon-reload
sudo systemctl enable --now tenggouwa-pi-agent.service

echo "✓ 装好了。看日志： journalctl -u tenggouwa-pi-agent -f"
