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

## 网络 / 环境要求（踩过的坑）

- **能出公网到 `api.tenggouwa.com`**。在需要 HTTP 代理才能出网的网络（公司/校园），
  `install.sh` 会问代理地址，写进 env 的 `http_proxy`/`https_proxy`（urllib 自动用）。
- **系统时钟要准**。差太多会让 HTTPS 证书校验失败（`certificate is not yet valid`）。
  NTP 被挡时可走代理取时间：
  `sudo date -s "$(curl -sI -x <proxy> http://www.gstatic.com/generate_204 | grep -i '^date:' | cut -d' ' -f2-)"`
- agent 已设自定义 `User-Agent`，避开 Cloudflare 对 `Python-urllib` 的默认拦截（error 1010）。

## 本地试跑（不装服务）

```bash
PI_AGENT_SERVER_URL=http://localhost:8000 PI_AGENT_TOKEN=dev-token \
  python3 -m agent.main
```

## 沙箱 exec（D2 · 让 agent 在 Pi 上跑 shell）

开启后，pi-agent 额外起一条线程长轮询后端，把 agent 批准过的 shell 命令在**本机 bwrap 沙箱**里执行、
回传结果。命令在服务器侧已经过 **TOTP 私有通道 + 逐条 C2 审批**（见
`docs/agent/agent-d2-sandbox-design.md`），Pi 这边再套一层 namespace 隔离。**默认关闭。**

**开启（Pi 侧）：**
```bash
sudo apt install -y bubblewrap          # 装 bwrap（隔离必需；没有它会拒绝执行）
# 确认非特权 userns 可用（多数 RPi OS 默认开；若报错再设）：
#   sudo sysctl -w kernel.unprivileged_userns_clone=1
# 在 /etc/tenggouwa-pi-agent.env 里加：
#   PI_AGENT_EXEC=1
#   PI_AGENT_WORKSPACE=/home/pi/.tenggouwa-agent/workspace   # 命令的可写工作目录（jailed）
#   PI_AGENT_EXEC_ALLOW_NET=0                                # 默认无网；要联网命令才设 1
sudo systemctl restart tenggouwa-pi-agent
```

**开启（服务器侧）：** prod `.env` 设 `AGENT_PI_SANDBOX=1`（未设则 `shell_exec` skill 整组拒用），
然后 `pnpm deploy:server`。

**隔离要点**（`agent/executor.py`）：`--clearenv`（命令读不到 daemon 的 `PI_AGENT_TOKEN` 等 env）
+ 系统只读、仅 workspace 可写、`--chdir` workspace + 默认 `--unshare-net`（无网）+ 单命令 120s 硬超时
+ 输出 64KB 上限。没装 bwrap 会**拒绝执行**（除非显式 `PI_AGENT_EXEC_ALLOW_UNSANDBOXED=1`，仅限你信得过的机器裸跑）。

> ⚠️ Pi 在你家 LAN 上：`PI_AGENT_EXEC_ALLOW_NET=0`（默认）很重要，否则命令能碰内网。
> Pi 非 throwaway 但可重刷，当「半可弃」——别在 workspace 外放你不愿被读的东西。
