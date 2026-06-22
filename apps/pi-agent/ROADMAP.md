# 树莓派平台路线图

把 `apps/pi-agent` 做成"把 Pi 玩透"的平台：一根脊梁（Pi 主动 outbound 连后端）+
多个模块，每个玩法 = pi-agent 一个 module + 网站 `/pi` 一个面板。分几天推进，
每个 Phase 独立一个 PR。

## ✅ 已完成

- **Phase 0+1 系统遥测**：Pi systemd 服务每 30s 上报 CPU温度/负载/内存/磁盘/uptime，
  `/pi` 实时显示，离线显示最后快照。含开机校时（无 RTC）、代理出网、绕 CF UA。
- **部署链路加固**：健康校验 + sha 回滚 + BuildKit cache + frozen-only + .dockerignore。
- **快照保留**：ingest 时删 >14 天旧行，表不无限涨。
- **Day A 遥测收尾**：`/pi` history 按 hostname 过滤（#81），测试行被动消失（过滤 + prune）。

## ⬜ 待办（按天）

### Day A — 遥测收尾（小）✅ 完成
- [x] `/pi` history 按 hostname 过滤（#81）。
- [x] 测试行：过滤后不显示 + 保留策略 14 天内 prune（不强删 prod DB）。
- [ ] （可选，未做）/pi 面板加网络吞吐 / 进程数等指标。

### Day B — Phase 2：Pi 接进 `/console` 终端 fleet
- [ ] 复用 mac-agent 的 outbound WSS PTY 协议，让 Pi 注册成一个 terminal agent。
- [ ] admin 发 agent token，Pi 上加一个 PTY module（或直接复用 mac-agent 跑在 Pi 上）。
- [ ] 验证从网站 `/console` / 手机能开 Pi 的终端。

### Day C-D — Phase 3：HID 远程打字机（签名玩法）
- [ ] 这台 Pi 本就是 USB HID gadget；研究现有 gadget 配置（`/dev/hidg0`、键盘 report descriptor）。
- [ ] 后端加指令队列：网页提交文本/脚本 → 队列；Pi 在线时拉取。
- [ ] pi-agent 加 HID module：把指令写进 `/dev/hidg0`，回执状态。
- [ ] `/pi` 加打字机面板（终端风输入框 + 发送）。
- [ ] 安全：只对自己的机器、明确授权场景。

### Phase 4 + 5 — "Pi 每日产物" ✅ 完成（合并实现）
- [x] Pi 每天自己算一张 ASCII 曼德博集合（区域随日期变）+ 真实渲染耗时（Phase 4 "live on a Pi"）。
- [x] 每日生成 + POST，`/pi` 展示 + "🍓 由 ops-pi 实时计算 · Xms" 徽章 + 每日一句（Phase 5）。
- [x] 后端 `pi_artifact` 表 + ingest/public 端点；走已验证的 stdlib-HTTP-经代理路。
- 后续可加更多 kind（fortune / git 活动图）。

### ⬜ 仍未做
- **Phase 2 /console PTY**：这网最难（WSS 穿代理 + 装 websockets + Pi 无 pip/venv），暂缓。
- **Phase 3 HID 远程打字机**：签名玩法；传输走 HTTP 易，难点是把 `/dev/hidg0` gadget 跑起来。

## 🔧 Backlog（跟 pi 无关，顺带记）

- [ ] `google-api-python-client`(14.6MB) 挪成可选依赖，给后端镜像/构建瘦身。
- [ ] Tailwind v4 升级（#30）仍 hold：typography/prose 在 v4 不生成，会破文章页。

## 环境备忘（ops-pi）

`ssh pi`（key `~/.ssh/id_pi`，sudo 密码在 `~/.ssh/pi-credentials.txt`）。在公司网需代理
`http://192.168.30.55:7890` 出公网；无 RTC 靠 `synctime.sh` 开机校时；CF 默认拦
`Python-urllib` UA，agent 已设自定义 UA。
