---
slug: ssh-deep
title: SSH 不只是登录：tunnel / agent / 跳板机 / config 模板
summary: Linux 系列第 20 篇。SSH 不仅是"远程登录"——它能转发端口（本地 / 远程 / 动态 SOCKS）、托管密钥、跳板穿透多层内网、批量 push 文件。这一篇把这些高级用法拆开，最后给一份 `~/.ssh/config` 让你 5 倍效率地管理几十台机器。
tags: [linux, linux-series, ssh, tunnel, jumphost, sshconfig]
published_at: 2026-07-03
---

> 这是 Linux 系列的第 20 篇——网络章节收尾。前面讲了"网络怎么通"，这一篇讲怎么用 SSH 这一个工具**把你和服务器之间的一切都打通**。

## 0. SSH 的本质：一条加密的字节流通道

你以为 SSH 只是个 telnet 升级版？它实际是一种**多路复用的加密通道协议**：

- 默认在通道里跑一个 PTY（伪终端）→ 这就是"登录"
- 也能在通道里跑任意 TCP 端口 → "tunnel"
- 也能跑 X11 协议 → 远程图形界面
- 也能跑 socket 转发 → "agent forwarding"

理解这一点，下面所有"花式用法"都是同一通道的不同切片。

---

## 1. 基础 + `~/.ssh/config`

最基本：

```bash
$ ssh user@server
$ ssh -p 22022 user@server
$ ssh -i ~/.ssh/my_key user@server
```

**敲多了非常累**。`~/.ssh/config` 给每台机器起别名：

```ssh-config
# ~/.ssh/config

Host openclaw
    HostName 101.37.211.203
    User root
    Port 22
    IdentityFile ~/.ssh/id_openclaw

Host web-prod
    HostName web.example.com
    User deploy
    Port 22022
    IdentityFile ~/.ssh/deploy_key

# 通配符
Host *.internal
    User admin
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null

# 全局默认
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
    AddKeysToAgent yes
```

配完：

```bash
$ ssh openclaw           # 等价于 ssh -p 22 -i ~/.ssh/id_openclaw root@101.37.211.203
$ ssh web-prod
$ ssh db.internal        # 匹配 *.internal
```

scp / rsync 也认这些别名：

```bash
$ scp file openclaw:/tmp/
$ rsync -av ./ web-prod:/var/www/
```

强烈建议**第一台服务器就给配上**——一年节省的打字量惊人。

### 常用 config 字段速记

| 字段 | 用途 |
|---|---|
| `HostName` | 真实 IP / 域名 |
| `User` | 远端用户 |
| `Port` | SSH 端口 |
| `IdentityFile` | 用哪个私钥 |
| `IdentitiesOnly yes` | **只**用 IdentityFile，不试别的 |
| `ProxyJump` | 跳板（见下面） |
| `LocalForward` | 本地端口转发 |
| `RemoteForward` | 远端端口转发 |
| `ServerAliveInterval` | 心跳间隔（防 NAT idle 断） |
| `ServerAliveCountMax` | 连续几次心跳失败就断连 |
| `ControlMaster auto` + `ControlPath ~/.ssh/cm-%r@%h:%p` | **连接复用**：下次 ssh 同一台秒进 |
| `Compression yes` | 压缩（慢网络有用，快网络可能反而慢） |

---

## 2. SSH 密钥 + agent

```bash
# 生成新密钥（推荐 ed25519，比 RSA 短且强）
$ ssh-keygen -t ed25519 -C 'my-key 2026'
# 默认存 ~/.ssh/id_ed25519 + .pub

# 把公钥放到服务器
$ ssh-copy-id user@server
# 或手动：cat ~/.ssh/id_ed25519.pub | ssh user@server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### `ssh-agent`：少敲一次密码

私钥设了 passphrase 后，每次 ssh 都问一遍——烦。`ssh-agent` 帮你缓存：

```bash
# 启动 agent
$ eval $(ssh-agent -s)

# 加密钥
$ ssh-add ~/.ssh/id_ed25519
Enter passphrase: ...
Identity added.

# 看现在 agent 里有哪些
$ ssh-add -l
```

之后 ssh 不再要密码。

**Mac 用户**：macOS 内置 keychain 集成，配 config：

```ssh-config
Host *
    AddKeysToAgent yes
    UseKeychain yes              # macOS-only
    IdentityFile ~/.ssh/id_ed25519
```

ssh-add 一次 → 重启都还在。

### Agent forwarding：从 A→B→git 都不用复制 key

```bash
$ ssh -A server
$ ssh server                       # 配 ForwardAgent yes 后等价
```

意思是"server 上的 ssh 进程能用我本地 agent 里的密钥"。**用途**：

```
你本地 → ssh → server → 在 server 上 git clone git@github.com:... 
                              ↑ 用你本地的 GitHub key（而不是 server 上的）
```

**安全提示**：`-A` 让远端 root 能用你的所有密钥——只对你信任的服务器开。

```ssh-config
Host github-builder
    ForwardAgent yes        # 只对这一台开
```

---

## 3. Port forward（tunnel）：SSH 通道里跑别的协议

### Local forward（`-L`）：本地端口 → 远端可达的目标

最高频。"我本地 `localhost:5432` 想访问 server 后面的 postgres"：

```bash
$ ssh -L 5432:db-internal:5432 jump-host
```

读法：

```
-L  本地端口 : 远端可达的目标 host : 目标端口
    │       │                    │
    5432    db-internal          5432
```

发生：

```
本地 psql localhost:5432
   ↓ TCP
你电脑的 ssh 进程
   ↓ SSH tunnel（加密）
jump-host 的 sshd
   ↓ TCP
db-internal:5432
```

你 `psql -h localhost -p 5432` 就连到了藏在内网的数据库，**不暴露 db 到公网**。

### Remote forward（`-R`）：远端端口 → 本地可达的目标

反过来——把**本地服务暴露给远端**：

```bash
# 本地跑了个 dev server 在 8080
$ python -m http.server 8080 &

# 让 server 上的人能访问
$ ssh -R 8080:localhost:8080 server

# server 上：curl localhost:8080 → 实际访问你本地的 8080
```

**用途**：

- 给同事临时演示本地服务
- 在没公网 IP 的家用机器上跑服务，通过有公网 IP 的 VPS 暴露
- ngrok / cloudflare tunnel 的免费替代

### Dynamic forward（`-D`）：SOCKS 代理

把整条 SSH 连接变成 SOCKS5 代理：

```bash
$ ssh -D 1080 jump-host
```

之后浏览器配 SOCKS5 = `localhost:1080`，**所有流量从 jump-host 出去**。等于一个临时 VPN，常用于：

- 翻看墙内被墙的资源（合规场景）
- 让外部测试看你内网的服务

---

## 4. Jump host：跳板机穿多层

很多公司架构：

```
你本地 → bastion（堡垒机/跳板机，公网 IP） → 内网服务器
                                              （没公网，只有 bastion 能 ssh）
```

传统做法：先 `ssh bastion`，进去后 `ssh internal-server`。麻烦。

`ProxyJump`（SSH 7.3+）一键穿透：

```bash
$ ssh -J bastion internal-server
```

或写到 config：

```ssh-config
Host bastion
    HostName bastion.example.com
    User me

Host *.internal
    User me
    ProxyJump bastion
```

之后：

```bash
$ ssh db.internal           # 自动经 bastion → db.internal
$ scp file db.internal:/tmp/
$ rsync -av ./ db.internal:/path/
```

**多层跳板**：

```ssh-config
Host hop2
    ProxyJump hop1

Host target
    ProxyJump hop2
```

走 你 → hop1 → hop2 → target，配一次终生用。

---

## 5. 连接复用（control master）：第二次秒进

每次 `ssh` 都要 TCP 握手 + TLS 握手 + 鉴权 = 几百毫秒。配复用：

```ssh-config
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m
```

第一次连后台开个长连接（保留 10 分钟），**后续 ssh / scp / rsync 同一台直接复用**——0.05 秒就进。

**坑**：

- 长连接没断开时你**改不了 user / port**（用同一通道）
- 想强制重连：`ssh -O exit <host>` 先关掉控制连接
- 通道挂了所有依赖它的 session 一起死

---

## 6. 文件传输：scp / rsync / sftp 都走 ssh

```bash
# scp（简单，但 OpenSSH 9 起用 sftp 底层，部分 flag 变了）
$ scp file.txt server:/tmp/
$ scp -r dir/ server:/tmp/
$ scp server:/etc/hosts ./remote-hosts
$ scp -P 22022 file server:/tmp/                # 注意 P 大写
$ scp -J bastion file internal:/tmp/             # 跳板

# rsync（智能、增量、可断点续传，**强烈推荐**）
$ rsync -avP file server:/tmp/
$ rsync -avP -e 'ssh -p 22022' file server:/tmp/  # 改端口

# sftp（交互式）
$ sftp server
sftp> ls
sftp> put file.txt
sftp> get remote.txt
sftp> bye
```

99% 场景 **rsync 优于 scp**（断点续传 + 增量 + 进度条）。

---

## 7. 远程执行命令 / 脚本

```bash
# 远端跑一条命令立刻退出
$ ssh server 'uptime'

# 多条
$ ssh server 'date; uptime; df -h'

# 跑本地脚本到远端（不用 scp 上去）
$ ssh server 'bash -s' < my-script.sh

# 带变量 / 参数
$ ssh server "echo Hello $USER"           # 双引号让 $USER 在本地展开
$ ssh server 'echo Hello $USER'           # 单引号让 $USER 在远端展开

# heredoc 跑一坨远端命令
$ ssh server 'bash -s' <<'EOF'
set -e
cd /var/www/app
git pull
systemctl restart myapp
EOF

# 在多台机器上并行（用 GNU parallel）
$ parallel -j 5 ssh {} uptime ::: web1 web2 web3 web4 web5
```

---

## 8. 实战：一些超有用的高阶用法

### A. SSH 当 git 跳板（写代码不用复制 key 上 server）

```ssh-config
Host github.com
    User git
    IdentityFile ~/.ssh/github_key
    
Host devbox
    HostName 1.2.3.4
    ForwardAgent yes
```

server 上 git clone / git pull 用的是**你本地的 GitHub key**——server 上根本没 key 文件，最安全。

### B. SSH config 加 alias 触发某条命令

```ssh-config
Host k8s-shell
    HostName k8s-bastion
    User me
    RemoteCommand kubectl exec -it api-pod -- /bin/bash
    RequestTTY yes
```

`ssh k8s-shell` → SSH 进 bastion → 立刻自动 kubectl exec 进 pod。一条命令穿 3 层。

### C. 端口转发后自动后台 + 不开 shell

```bash
$ ssh -fNT -L 5432:db:5432 jump-host
```

- `-f` background
- `-N` 不执行命令（只建 tunnel）
- `-T` 不分配 TTY

适合后台开几条 tunnel 不打扰你的终端。

### D. 用 SSH 当 SOCKS 代理 + autossh 自动重连

```bash
$ sudo apt install autossh
$ autossh -M 0 -fNT -D 1080 jump-host
```

`autossh` 在网络抖动时自动重连——比 ssh 直接跑稳得多。

### E. tmux + ssh 防断网

跑长任务时，**先 ssh，再开 tmux**：

```bash
$ ssh server
$ tmux new -s work
（跑长任务）
Ctrl+B d        # 脱离 tmux，回到原 shell

# 几小时后
$ ssh server
$ tmux attach -t work       # 回到之前的会话
```

ssh 断了 tmux 不死。

---

## 9. SSH 安全清单（公网服务器必看）

```ssh-config
# /etc/ssh/sshd_config (server 端，不是 client 的 ~/.ssh/config)

# 强制 key 登录，禁密码（关键！防爆破）
PasswordAuthentication no
PubkeyAuthentication yes

# 禁 root 直接 ssh（要先 ssh 普通用户再 sudo）
PermitRootLogin no
# 或者只允许 key 登录 root（保留紧急救援能力）
PermitRootLogin prohibit-password

# 限制能 ssh 的用户
AllowUsers alice bob deploy

# 改默认端口（防扫描器，但不是真安全；安全靠 key）
Port 22022

# 缩短超时，干净退出空闲连接
ClientAliveInterval 60
ClientAliveCountMax 3

# 禁用 X11 / agent forward 等用不到的
X11Forwarding no
```

改完：

```bash
$ sudo sshd -t           # 语法测试（不重启）
$ sudo systemctl restart sshd
```

> **测试前别关现有 ssh 会话**——万一改错了，新 ssh 进不来你还有老连接救场。

---

## 10. 现在做一件事

```bash
# 1. 生成一对密钥（如果还没）
$ ssh-keygen -t ed25519

# 2. 配 ~/.ssh/config 给你常连的服务器起别名
$ vim ~/.ssh/config

# 3. 把 ssh-add 调成 auto（加到 ~/.zshrc 或 ~/.bashrc）
$ eval $(ssh-agent -s) ; ssh-add ~/.ssh/id_ed25519
# Mac：直接配 UseKeychain yes

# 4. 给你最频繁的服务器开 ControlMaster
# 测一下：连过一次后再 ssh 同一台
$ time ssh server exit
$ time ssh server exit       # 第二次应该 < 0.1s

# 5. 试一次 port forward 把远端服务"借"到本地
$ ssh -L 6379:localhost:6379 server
# 另一个 terminal：redis-cli -h localhost
```

SSH 是日常运维的 80% 入口——把它调到顺手，你之后做任何远程操作都飞快。

---

> **下一篇**：[observability](observability)——`top / iotop / iostat / vmstat / strace`，机器在干什么——CPU / 内存 / 磁盘 / 网络的实时观测。
