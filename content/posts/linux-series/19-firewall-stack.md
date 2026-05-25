---
slug: firewall-stack
title: Linux 防火墙全栈：iptables / nftables / ufw / firewalld 几层
summary: Linux 系列第 19 篇。新手第一次看到 `iptables -nvL` 输出几百行就懵——而且还有 nftables / ufw / firewalld / Docker 加的规则一锅端。这一篇拆 netfilter 的核心 5 个钩子点、iptables → nftables 的迁移现状、ufw 和 firewalld 各自适用谁、Docker 怎么搅动这一锅。
tags: [linux, linux-series, firewall, iptables, nftables, netfilter]
published_at: 2026-07-02
---

> 这是 Linux 系列的第 19 篇。上一篇讲怎么"用"网络——这一篇讲怎么"拦"。

## 0. 几个名字先理清

新手最大的困惑是同一个东西有 5 个名字：

```
netfilter     ── 内核里那套钩子机制（真正干活的）
   ├─ iptables   ── 老的用户态命令（操作 netfilter）
   ├─ nftables   ── 新的（取代 iptables）
   ├─ ufw        ── Ubuntu 的"前端"，最后还是调 iptables/nftables
   └─ firewalld  ── RHEL/Fedora 的"前端"，同上
```

**真正干活的只有内核的 netfilter**——iptables / nftables / ufw / firewalld **全是它的前端**，最后都把规则编译成 netfilter 钩子。

学一遍 netfilter 的模型，剩下都是语法差异。

---

## 1. netfilter 的 5 个 hook（核心）

每个网络包进入 Linux 后，会经过几个**hook 点**——这些点上挂着规则链：

```
                              本机进程
                                ↑↓
                                │ output / input
                                │
    eth0  →  PREROUTING  →  routing   →  FORWARD  →  POSTROUTING  →  eth0
              (DNAT)        decision     (filter)      (SNAT)
                              ↓
                            INPUT (filter) → 本机进程
                            
    本机进程 → OUTPUT (filter) → routing → POSTROUTING (SNAT) → eth0
```

5 个 hook：

| Hook | 时机 | 主要用途 |
|---|---|---|
| **PREROUTING** | 包刚进网卡 | DNAT（端口转发）、改 mark |
| **INPUT** | 决定送给本机进程之前 | 拦"进我机器的"流量 |
| **FORWARD** | 决定转发出去之前 | 拦"穿过我机器的"流量（路由器场景） |
| **OUTPUT** | 本机进程发出包之前 | 拦"我发出去的"流量 |
| **POSTROUTING** | 包要从网卡出去前 | SNAT（NAT 出门换源 IP） |

每个 hook 上有一条**链**（chain），链里挂规则——按顺序匹配，第一个 match 就执行 action。

### 4 张表（table）：规则的"分类"

netfilter 还把规则按用途分到 4 张表：

| 表 | 干什么 | 关联 hook |
|---|---|---|
| `filter` | 允许 / 拒绝（**最常用**） | INPUT / OUTPUT / FORWARD |
| `nat` | 改源/目的 IP+端口 | PREROUTING / POSTROUTING / OUTPUT |
| `mangle` | 改包字段（TTL、TOS） | 全部 hook |
| `raw` | 跳过 conntrack | PREROUTING / OUTPUT |

**99% 的用户只关心 `filter` 表的 INPUT 链**——"拦截进我机器的流量"。

---

## 2. iptables：经典命令（即将退场但仍流行）

iptables 是 1998 年来的接口，**还在 95% 的生产服务器上活着**。

### 看当前规则

```bash
# 看 filter 表所有链（最常看的）
$ sudo iptables -nvL
Chain INPUT (policy ACCEPT 1234 packets, 567K bytes)
 pkts bytes target     prot opt in     out     source         destination
  100  5K   ACCEPT     tcp  --  *      *       0.0.0.0/0      0.0.0.0/0    tcp dpt:22
   50  3K   ACCEPT     tcp  --  *      *       0.0.0.0/0      0.0.0.0/0    tcp dpt:80
    0    0   DROP       all  --  *      *       1.2.3.4/32     0.0.0.0/0

Chain FORWARD (policy DROP 0 packets, 0 bytes)
...

Chain OUTPUT (policy ACCEPT 8910 packets, 2M bytes)
```

读法：

- `policy ACCEPT` = 没匹配任何规则的默认动作（**主机型服务器一般 INPUT 默认 ACCEPT，加规则 DROP 不要的**）
- 每行一条规则：`pkts / bytes` 是命中包数，`target` 是动作，剩下是匹配条件

```bash
# 看其他表
$ sudo iptables -nvL -t nat
$ sudo iptables -nvL -t mangle
```

### 加规则 / 删规则

```bash
# 允许 SSH（22）
$ sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# 允许 web（80, 443）
$ sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 允许本地环回（不允许会有大批服务跪）
$ sudo iptables -A INPUT -i lo -j ACCEPT

# 允许已经建立的连接的返程包
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# 拒绝某 IP 全部访问
$ sudo iptables -A INPUT -s 1.2.3.4 -j DROP

# 删一条规则（按编号；先 -nvL --line-numbers 看号）
$ sudo iptables -nvL --line-numbers
$ sudo iptables -D INPUT 3

# 清空整个链（小心！没有撤回）
$ sudo iptables -F INPUT
```

flag：

```
-A chain   append（加到链末尾）
-I chain   insert（加到链开头）
-D chain   delete
-F chain   flush（清空）
-P chain   policy（改默认动作）
-p tcp     协议
--dport    目的端口
--sport    源端口
-s X.X.X.X 源 IP
-d X.X.X.X 目的 IP
-i iface   入网卡
-o iface   出网卡
-m module  扩展匹配（如 -m conntrack --ctstate）
-j target  动作（ACCEPT / DROP / REJECT / DNAT 等）
```

### action 速记

| action | 含义 |
|---|---|
| `ACCEPT` | 放行 |
| `DROP` | **静默丢**（对方不知道发生了什么，timeout） |
| `REJECT` | 拒绝（对方收到 ICMP unreachable，知道被拦） |
| `LOG` | 记日志（写到 dmesg），通常配上 `-j LOG --log-prefix "..."` |
| `RETURN` | 跳出当前链 |
| `<custom-chain>` | 跳到自定义子链 |

**DROP vs REJECT 选谁**：

- 服务器对公网：`DROP`（让扫描器猜测延迟）
- 内网友好：`REJECT`（程序立刻知道不行，快速失败）

### 规则**重启后丢失**！怎么持久化

iptables 改完默认**重启就没了**。要持久化：

```bash
# Ubuntu/Debian
$ sudo apt install iptables-persistent
$ sudo netfilter-persistent save

# CentOS/RHEL
$ sudo iptables-save > /etc/sysconfig/iptables

# 通用方案
$ sudo iptables-save > /etc/iptables/rules.v4
$ sudo ip6tables-save > /etc/iptables/rules.v6
```

**改完一定要 save**——血泪教训。

---

## 3. nftables：iptables 的接班人

2014 年起 Linux 内核就加了 nftables，**Debian 10+ / Ubuntu 20.10+ / RHEL 8+ 默认用它**。`iptables` 命令今天大部分是 nftables 的 wrapper（`iptables-nft`）。

语法更现代、更统一：

```bash
# 看所有规则
$ sudo nft list ruleset

# 加一张表
$ sudo nft add table inet myfilter

# 在表里加链（指定 hook + priority + policy）
$ sudo nft add chain inet myfilter input { type filter hook input priority 0\; policy drop\; }

# 加规则
$ sudo nft add rule inet myfilter input ct state established,related accept
$ sudo nft add rule inet myfilter input iif lo accept
$ sudo nft add rule inet myfilter input tcp dport 22 accept
$ sudo nft add rule inet myfilter input tcp dport {80, 443} accept
```

特点：

- `inet` 这种 family 同时管 IPv4 + IPv6（不用写两遍）
- 集合 `{80, 443}` 原生支持
- 一切都是文本，能用 `nft -f rules.nft` 整批 load

**生产建议**：

- **新机器**直接用 nftables
- **老服务器**继续用 iptables 命令（其实底下是 nftables），完全兼容
- 不用同时跑两套，挑一套

### nftables 持久化

```bash
$ sudo nft list ruleset > /etc/nftables.conf
$ sudo systemctl enable nftables
$ sudo systemctl start nftables
```

---

## 4. `ufw`：Ubuntu 友好前端

ufw = Uncomplicated FireWall。给"不想学 iptables/nftables"的人准备的：

```bash
# 装
$ sudo apt install ufw

# 默认策略
$ sudo ufw default deny incoming
$ sudo ufw default allow outgoing

# 开端口
$ sudo ufw allow 22/tcp
$ sudo ufw allow 'OpenSSH'                   # 用 app 名字
$ sudo ufw allow from 10.0.0.0/24 to any port 5432   # 限源 IP
$ sudo ufw allow 80,443/tcp                  # 多端口

# 启用 / 看状态
$ sudo ufw enable
$ sudo ufw status verbose
$ sudo ufw status numbered                   # 带编号方便删
$ sudo ufw delete 3

# 完全关掉
$ sudo ufw disable
```

ufw 在底下生成 iptables/nftables 规则。**简单服务器 80% 场景 ufw 就够**。

### 容易踩的坑：先 enable 后改

```bash
$ sudo ufw default deny incoming
$ sudo ufw enable        # ← 这一刻你的 SSH 可能就断了！
```

**enable 之前**一定要先 `ufw allow 22`，否则你立刻就回不去了（远程机的话）。

---

## 5. `firewalld`：RHEL 友好前端

CentOS/RHEL/Fedora 默认装的，跟 ufw 同位。概念是"zone"：

```
public zone    → 默认拒绝所有 (除了 SSH)
work zone      → 允许 SSH / DHCPv6
internal zone  → 允许更多
trusted zone   → 允许全部
```

每个网卡绑定到一个 zone：

```bash
$ firewall-cmd --get-default-zone
public

$ sudo firewall-cmd --zone=public --add-service=http --permanent
$ sudo firewall-cmd --zone=public --add-port=8080/tcp --permanent
$ sudo firewall-cmd --reload

$ firewall-cmd --list-all
```

`--permanent` 是写到磁盘，`--reload` 加载。**不带 permanent 的临时改，reload 就没**。

实战中我觉得 firewalld 比 ufw 抽象多了一层，不如直接学 nft 命令。但 RHEL 默认装，遇到要会用。

---

## 6. Docker 怎么搞乱 iptables

Docker daemon 默认会**自动添加一堆 iptables 规则**让容器能上网：

```bash
$ sudo iptables -nvL -t nat
Chain DOCKER (2 references)
 pkts bytes target     prot opt in     out     source         destination
    0    0   RETURN     all  --  docker0 *      0.0.0.0/0      0.0.0.0/0
   12  720  DNAT       tcp  --  !docker0 *      0.0.0.0/0      0.0.0.0/0    tcp dpt:8080 to:172.17.0.2:80
```

读法：

- 你 `docker run -p 8080:80` 时，docker 在 `nat` 表 `PREROUTING` 加 DNAT 规则——访问宿主机 8080 → 转发到容器 80
- 它也加 `MASQUERADE` 让容器流量出门换成宿主机 IP

**最大坑**：你写 iptables/ufw 规则**不一定能拦住 Docker 容器的端口**。因为 docker 的 DNAT 在 PREROUTING 发生，**早于** filter 表的 INPUT 链。即使你 `ufw deny 8080`，docker 已经在更早的钩子上做了转发。

解决方案（任选）：

```bash
# A. 让 docker 不要自动改 iptables
$ cat /etc/docker/daemon.json
{
  "iptables": false
}
# 然后自己写规则（高阶，慎用）

# B. 让 docker 把容器端口只 bind 在 127.0.0.1
$ docker run -p 127.0.0.1:8080:80 ...
# 别的机器访问不到，简单粗暴

# C. ufw 配合 docker 的特殊 chain
# 用 ufw-docker 之类的工具
```

**最常用的是 B**——容器端口默认只 listen `127.0.0.1`，反向代理（nginx）放在前面再统一暴露 443。

---

## 7. 一份"主机型服务器最小防火墙"模板

```bash
#!/bin/bash
# 假设这是公网 VPS，要：开 22 / 80 / 443，其他拒绝

# 清空（小心，会断 SSH 如果你跑这条时没立刻补 ssh 规则）
sudo iptables -F INPUT

# 默认 policy：先临时 ACCEPT（防止断 SSH）
sudo iptables -P INPUT ACCEPT

# 加规则
sudo iptables -A INPUT -i lo -j ACCEPT                                    # 本地环回
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT  # 返程包
sudo iptables -A INPUT -p icmp -j ACCEPT                                  # 允许 ping
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT                        # SSH
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 最后改 policy 为 DROP
sudo iptables -P INPUT DROP

# 持久化
sudo netfilter-persistent save     # Ubuntu/Debian
# 或
sudo iptables-save > /etc/sysconfig/iptables       # CentOS
```

或者 ufw 版（同效果）：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80,443/tcp comment 'HTTP/HTTPS'
sudo ufw enable
```

---

## 8. 常见排查场景

### 场景 A：服务在跑但外面连不上

```bash
# 1. 进程真的在监听 0.0.0.0 吗？（不是 127.0.0.1）
$ sudo ss -tlnp | grep :8080
LISTEN  0  128  *:8080  *:*  users:(("python",pid=...))
# *  / 0.0.0.0 → 公网能连
# 127.0.0.1 → 只本机能连（典型坑）

# 2. 防火墙规则拦没拦
$ sudo iptables -nvL INPUT
$ sudo ufw status

# 3. 云厂商安全组拦没拦（90% 是这）
# 阿里云/AWS/腾讯云每个 VPC 还有一层安全组，要去 web 控制台开

# 4. 中间路径
$ sudo tcpdump -i any -n port 8080
# 在 server 上抓包，从客户端发请求，看包到没到
```

### 场景 B：你的规则不生效

```bash
# 1. 看完整的规则栈（防 docker 等加了你不知道的规则）
$ sudo iptables-save | less
$ sudo nft list ruleset

# 2. 加 LOG target 看包到底走到哪
$ sudo iptables -I INPUT -p tcp --dport 8080 -j LOG --log-prefix "MYAPP-IN: "
$ sudo dmesg -w | grep MYAPP-IN
# 然后让客户端发请求，看 dmesg 是否打印
```

---

## 9. 现在做一件事

```bash
# 1. 看你机器现在有啥规则
$ sudo iptables -nvL --line-numbers
# 或者新版
$ sudo nft list ruleset

# 2. 看你机器现在开了哪些端口
$ sudo ss -tlnp

# 3. 看 docker 加了多少 NAT 规则（如果装了 docker）
$ sudo iptables -nvL -t nat | grep -c DOCKER

# 4. 看你云厂商 metadata（哪个 zone / VPC / 安全组）
$ curl -s http://169.254.169.254/latest/meta-data/security-groups || \
  curl -s http://100.100.100.200/latest/meta-data/region-id

# 5. 如果是公网机器，立刻确认你的 SSH 规则在
$ sudo iptables -nvL INPUT | grep -E 'dpt:22|tcp.*22'
```

理解 netfilter 模型，你看任何防火墙工具都是变体。

---

> **下一篇**：[ssh-deep](ssh-deep)——SSH 不只是登录：tunnel、agent forwarding、跳板机、~/.ssh/config 模板，让你 5 倍效率地穿梭于服务器之间。
