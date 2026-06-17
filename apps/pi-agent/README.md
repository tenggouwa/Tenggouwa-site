# tenggouwa-pi-agent

把树莓派的系统状态（CPU 温度 / 负载 / 内存 / 磁盘 / uptime）周期上报到
`api.tenggouwa.com`，在个人站 `/pi` 页实时显示。Pi 偶尔开机也没关系——离线时
面板显示最后一次快照 + last seen。

## 怎么工作

```
Raspberry Pi
  ├── systemd 起 python3 -m agent.main
  ├── 每 30s 读 /proc、/sys、os.statvfs 采一份遥测
  ├── POST https://api.tenggouwa.com/api/agent/pi/report
  │      Authorization: Bearer <PI_AGENT_TOKEN>
  └── 后端存最新快照；/pi 页轮询 /api/public/pi/status 显示
```

服务器**没有任何入站连接**，全部走 Pi 主动发起的 outbound HTTPS。
纯 stdlib，零三方依赖，用系统 `python3` 直接跑，不建 venv。

## 安装（在 Pi 上）

```bash
# 后端先配好 PI_AGENT_TOKEN 环境变量（与下面输入的 token 一致），再：
cd apps/pi-agent
./install.sh          # 询问后端地址 + token + 间隔，装成 systemd 服务
journalctl -u tenggouwa-pi-agent -f   # 看日志
```

## 卸载

```bash
sudo systemctl disable --now tenggouwa-pi-agent.service
sudo rm /etc/systemd/system/tenggouwa-pi-agent.service /etc/tenggouwa-pi-agent.env
sudo systemctl daemon-reload
```

## 本地试跑（不装服务）

```bash
PI_AGENT_SERVER_URL=http://localhost:8000 PI_AGENT_TOKEN=dev-token \
  python3 -m agent.main
```
