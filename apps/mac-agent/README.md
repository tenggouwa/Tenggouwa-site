# tenggouwa-mac-agent

把这台 Mac 的本地 pty（zsh / bash / fish 都行）通过 WSS 暴露到
`api.tenggouwa.com`，配合 admin 的 `/terminal` 页就能从手机远程操作。

## 怎么工作

```
Mac (本机)
  ├── ~/.tenggouwa-agent/.venv/bin/python -m agent.main
  ├── 持续 outbound WSS 到 wss://api.tenggouwa.com/api/agent/ws
  ├── 收到首帧 stdin → spawn 一个 pty 跑 $SHELL -l
  ├── pty stdout → 二进制 WSS 帧
  └── ws 文本帧 = JSON 控制（resize / kill）
```

服务器**没有任何入站连接**。所有通信走你 Mac 主动建立的 outbound TLS。

## 安装

```bash
# 1) 在 admin 后台 → 站点设置 → 终端 → 新建 agent，拿到一次性 token
# 2) 在 Mac 上跑：
cd apps/mac-agent
./install.sh
# 会提示输入 token，写入 ~/.tenggouwa-agent/config.toml
# 自动建 venv + 装 launchd
```

## 看日志 / 调试

```bash
tail -f ~/.tenggouwa-agent/stderr.log
launchctl list | grep tenggouwa
```

## 卸载

```bash
launchctl unload ~/Library/LaunchAgents/com.tenggouwa.agent.plist
rm ~/Library/LaunchAgents/com.tenggouwa.agent.plist
rm -rf ~/.tenggouwa-agent
```

并在 admin 后台「撤销」对应 agent，防止 token 被滥用。

## 安全模型

- agent_token 只在创建时返回一次，服务端只存 sha256；丢失只能撤销 + 新建
- agent 没有写 admin 的能力——它只能开 pty 转发字节
- 终端 session 全程审计：开启时间、字节数、解锁方式（voice / totp）、客户端 IP 都进 PG
- 服务端跟客户端配对时单 active session：手机重新连会踢掉旧的
