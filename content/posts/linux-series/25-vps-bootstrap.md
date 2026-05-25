---
slug: vps-bootstrap
title: 5 分钟把一台新 VPS 调到能放心跑业务（系列收官）
summary: Linux 系列第 25 篇 · 终篇。把前 24 篇的知识合成一张可执行的清单——一台空 VPS 到手，按这个顺序走一遍，30 分钟内你就有了一台权限收紧、监控就位、防火墙在岗、日志会轮转、能扛得起业务的服务器。
tags: [linux, linux-series, vps, bootstrap, security, hardening]
published_at: 2026-07-08
---

> 这是 Linux 系列的第 25 篇——**终篇**。25 篇的所有知识，凝结成一份"新机器开箱清单"。每一步都对应前面某一篇的展开，需要细节回去翻；不需要的话照着敲完，半小时一台合格 server。

## 0. 假设

- 拿到了一台空 VPS（阿里云 / DigitalOcean / Hetzner / Linode 等都行）
- 默认装的是 Ubuntu 22.04 / 24.04 LTS（其他发行版命令稍变，逻辑一样）
- 你有 root 的初始密码 / SSH key
- 目标是跑业务服务（nginx、应用、数据库 / 或者 Docker）

整个 bootstrap 分 8 步，按顺序做。

---

## 1. SSH 第一次进去 + 改 root 密码

```bash
$ ssh root@<ip>
# 输入云厂商给的初始密码
```

进去**第一件事**改密码（很多云厂商会把初始密码发邮件，外漏风险高）：

```bash
$ passwd
```

---

## 2. 建一个普通用户 + sudo + 禁 root 直接登录

```bash
$ adduser deploy             # 按提示设密码
$ usermod -aG sudo deploy    # 加入 sudo 组（Debian/Ubuntu）
# RHEL/CentOS：usermod -aG wheel deploy

# 把你本地的 SSH key 复制到这个用户
$ mkdir -p /home/deploy/.ssh
$ cp ~/.ssh/authorized_keys /home/deploy/.ssh/
$ chown -R deploy:deploy /home/deploy/.ssh
$ chmod 700 /home/deploy/.ssh
$ chmod 600 /home/deploy/.ssh/authorized_keys
```

**测试新用户能登录**（**不要先关掉当前 root session**！）：

新终端：

```bash
$ ssh deploy@<ip>
$ sudo whoami
root         # OK，sudo 工作
```

确认 ok 后，**禁 root 直接 SSH**：

```bash
# 在 root session
$ vim /etc/ssh/sshd_config
```

改：

```
PermitRootLogin no
PasswordAuthentication no                # 强制 key 登录
PubkeyAuthentication yes
```

加固（可选）：

```
ClientAliveInterval 60                    # 心跳防 NAT idle 断
ClientAliveCountMax 3
MaxAuthTries 3
LoginGraceTime 30
AllowUsers deploy                          # 白名单
```

测试 + 重启 sshd：

```bash
$ sudo sshd -t                             # 语法测试
$ sudo systemctl restart sshd
```

> **再起一个新终端测试 `ssh deploy@<ip>`**——别在当前 session 直接退出，万一改错你会被关在门外。

---

## 3. 系统更新 + 装基本工具

```bash
# 包管理器更新
$ sudo apt update && sudo apt upgrade -y

# 安装基础工具
$ sudo apt install -y \
    htop iotop sysstat ncdu \
    curl wget jq tree \
    git vim \
    fail2ban ufw \
    unattended-upgrades \
    tmux mtr-tiny dnsutils net-tools \
    fd-find ripgrep    # 现代 find / grep

# 自动安全更新（重要！）
$ sudo dpkg-reconfigure -plow unattended-upgrades
# 按提示选 yes
```

---

## 4. 防火墙：先 deny 后 allow

```bash
$ sudo ufw default deny incoming
$ sudo ufw default allow outgoing
$ sudo ufw allow 22/tcp comment 'SSH'         # ← 先 allow SSH 再 enable，否则关在门外
$ sudo ufw allow 80,443/tcp comment 'HTTP/HTTPS'
$ sudo ufw enable
$ sudo ufw status verbose
```

如果换了 SSH 端口（比如 22022），开那个：

```bash
$ sudo ufw allow 22022/tcp comment 'SSH'
$ sudo ufw delete allow 22/tcp                # 删掉旧规则
```

> **云厂商的安全组**：阿里云 / AWS / 腾讯云在 VPC 层还有一层，要去 web 控制台同步开放端口。**这是 90% 新手"我装了 nginx 为什么访问不到"的根因**。

### fail2ban：自动封爆破 IP

```bash
$ sudo systemctl enable --now fail2ban

# 看状态
$ sudo fail2ban-client status
$ sudo fail2ban-client status sshd
```

fail2ban 自动监控 SSH 失败日志，触发阈值后用 iptables 拉黑那个 IP。

---

## 5. 内核参数 + ulimit（性能基线）

`/etc/sysctl.d/99-tuning.conf`:

```ini
# 文件描述符
fs.file-max = 1000000

# 网络
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_syncookies = 1

# 内存
vm.swappiness = 10
vm.overcommit_memory = 1

# 安全
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
```

`/etc/security/limits.d/99-nofile.conf`:

```
*  soft  nofile  65536
*  hard  nofile  65536
```

加载：

```bash
$ sudo sysctl --system
```

### swap（小机器必备）

阿里云 1G/2G 机型常常不带 swap：

```bash
$ free -h | grep Swap
Swap:           0B          0B          0B          # 没 swap

# 加 1G swap
$ sudo fallocate -l 1G /swapfile
$ sudo chmod 600 /swapfile
$ sudo mkswap /swapfile
$ sudo swapon /swapfile
$ echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 验证
$ free -h
```

---

## 6. 时区 + NTP（日志时间戳清晰）

```bash
# 设时区
$ sudo timedatectl set-timezone Asia/Shanghai
$ timedatectl                              # 验证

# NTP 已经被 systemd-timesyncd 默认开了，检查
$ timedatectl status | grep 'NTP service'
NTP service: active
```

时区错了会让所有日志、监控、定时任务时间错乱——上来就设。

---

## 7. 日志轮转 + journald 限制

journald 大小限制：

```bash
$ sudo vim /etc/systemd/journald.conf
```

```ini
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
MaxRetentionSec=4week
```

```bash
$ sudo systemctl restart systemd-journald
```

logrotate 默认装好了。装应用时记得加自己的：

`/etc/logrotate.d/myapp`:

```
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0644 myapp myapp
    postrotate
        systemctl reload myapp.service > /dev/null 2>&1 || true
    endscript
}
```

---

## 8. 装运行时（按需）

### Docker

```bash
$ curl -fsSL https://get.docker.com | sudo bash
$ sudo usermod -aG docker deploy            # 让 deploy 不用 sudo 用 docker
$ sudo systemctl enable --now docker

# 给 docker daemon 加日志轮转 + 国内镜像（如果你在国内）
$ sudo vim /etc/docker/daemon.json
```

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ]
}
```

```bash
$ sudo systemctl restart docker
```

退出 deploy 再 ssh 重登，`docker ps` 不报权限错就好。

### Node / Python / Go（按需）

```bash
# Node：用 nvm 不用包管理器
$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Python：默认带了 3.10/3.12，业务用 venv
$ sudo apt install -y python3-venv python3-pip

# Go：直接下载二进制
$ wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
$ sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
$ echo 'export PATH=/usr/local/go/bin:$PATH' >> ~/.bashrc
```

---

## 9. 监控基础（轻量级）

最小可用：

```bash
# 看历史负载（sar 5 天）
$ sudo systemctl enable --now sysstat

# 看哪个进程吃资源
$ htop                                      # 已经装了

# 装 Tailscale 让自己能从手机看监控（可选）
$ curl -fsSL https://tailscale.com/install.sh | sudo bash
$ sudo tailscale up
```

进阶（要监控曲线）：

```bash
# 简单方案：node_exporter + 一台中心机跑 Prometheus + Grafana
$ wget https://github.com/prometheus/node_exporter/releases/...
（具体步骤太多，单独开篇）
```

或者用阿里云 / 各家自带的监控服务。

---

## 10. 最后：业务部署 + 备份

### 业务部署（systemd）

```bash
$ sudo vim /etc/systemd/system/myapp.service
```

参考 [17 systemd-services](systemd-services) 的"生产级模板"。

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now myapp
$ sudo systemctl status myapp
$ journalctl -u myapp -f
```

### nginx 反向代理（如果有 web）

```bash
$ sudo apt install -y nginx certbot python3-certbot-nginx
$ sudo systemctl enable --now nginx

# 拿免费 HTTPS 证书
$ sudo certbot --nginx -d example.com -d www.example.com
# 跟着提示走，证书自动续期已经配好
```

### 备份（务必）

把你的数据库 / 应用数据用 rsync 推到另一台机器：

```bash
$ sudo vim /etc/cron.daily/backup
```

```bash
#!/bin/bash
set -e
DATE=$(date +%F)

# 应用数据
rsync -avh --delete \
    --link-dest=/backup-nas/$(date -d 'yesterday' +%F) \
    /var/lib/myapp/ \
    backup-user@nas:/backups/$(hostname)/$DATE/

# 数据库
docker exec postgres pg_dumpall -U postgres | \
    gzip > /tmp/pg-$DATE.sql.gz
rsync -avh /tmp/pg-$DATE.sql.gz backup-user@nas:/backups/$(hostname)/db/
rm /tmp/pg-$DATE.sql.gz
```

```bash
$ sudo chmod +x /etc/cron.daily/backup
```

---

## 11. 自查清单

跑完上面 1-10 步，按这个清单确认每一项：

- [ ] SSH 用 key 登录，root 不能直接登
- [ ] 普通用户 deploy 在 sudo 组
- [ ] ufw 已 enable，22/80/443 在白名单
- [ ] fail2ban 在跑
- [ ] unattended-upgrades 已配置
- [ ] sysctl 调过，ulimit 调过
- [ ] swap 已加（小机器）
- [ ] 时区设了 Asia/Shanghai
- [ ] journald 限制了大小
- [ ] 业务服务用 systemd 跑（不是 nohup &）
- [ ] HTTPS 证书已自动续期
- [ ] 备份脚本 daily 跑

任何一项没勾 → 回到对应章节补。

---

## 12. 25 篇旅程回顾

```
Ⅰ. 心智模型（01-05）
   why-linux → kernel-vs-userspace → everything-is-a-file
   → shell-as-glue → fhs-tour

Ⅱ. 日常 shell 工具（06-10）
   finding-things → text-pipes → redirection → process-control
   → shells-rcfile

Ⅲ. 文件与权限（11-14）
   permissions → links-inodes → mount-and-fs → archive-rsync

Ⅳ. 进程与并发（15-17）
   fork-exec → signals → systemd-services

Ⅴ. 网络（18-20）
   net-tools → firewall-stack → ssh-deep

Ⅵ. 性能与调试（21-23）
   observability → logs → kernel-tuning

Ⅶ. 容器与部署（24-25）
   containers-inside → vps-bootstrap ←（你在这）
```

把这 25 篇当作**索引**——遇到问题去翻对应章节，比从零搜索引擎找答案高效得多。

---

## 13. 现在做一件事

如果你跟着这一篇真的开了一台新 VPS：

1. 把上面 1-10 步执行完
2. 截个 `htop` / `ufw status` / `systemctl status myapp` 三连图给自己
3. 把 `/etc/sysctl.d/99-tuning.conf` 和 `/etc/security/limits.d/99-nofile.conf` 这两个文件 push 到你的 dotfiles 仓库
4. 下次新机器，**Ansible playbook 或者 shell 脚本一键跑完**——5 分钟搞定

> **"Infrastructure as Code"的入门**就是：把你 ssh 进 server 敲过的每一条命令，沉淀成可重复执行的脚本。

---

## 14. 系列结束语

25 篇下来，你应该从"Linux 用户"变成"Linux 居民"——

- **不再恐惧打开终端**——它是你的家
- **不再死记命令**——你理解每个命令背后的内核机制
- **不再迷信 GUI / 控制台**——你知道任何 GUI 都是某个文本接口的封装
- **遇到陌生 Linux 不慌**——FHS、systemd、sysctl 在哪都一样
- **看 K8s / Docker / 云原生**——都是这些古老组件的现代组合

Linux 1991 年至今 30 多年，**这套设计哲学跨越了几个时代仍在生效**——从拨号上网的工作站到 2026 年的 AI 训练集群。学透它不是为了"跟上潮流"，而是给自己一份**几十年贬值率为零**的基本功。

打开终端，住下来。

---

> **完结**。如果你跟着读完 25 篇并跑过其中大部分命令——你已经超过了大多数自称"会用 Linux"的人。
>
> 接下来的进阶方向：
> - **eBPF / Tracing**：现代内核观测术
> - **Kubernetes / 云原生**：容器编排
> - **Rust / Zig 系统编程**：写工具，造你自己的 ls / cat / fd
> - **NixOS / 不可变系统**：把"配置即代码"做到极致
>
> 选一个开始下一段旅程。
