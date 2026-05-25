---
slug: kernel-tuning
title: 调内核：/proc/sys、sysctl、cgroup 把小机器调出大性能
summary: Linux 系列第 23 篇。"我这台 1G 机器并发上不去"——很多时候不是机器小，是默认内核参数太保守。这一篇拆 sysctl 怎么改、最常用的 10 个网络 / 内存 / fs 参数、cgroup v2 怎么限制单进程资源、最后给一份生产服务器的内核参数模板。
tags: [linux, linux-series, kernel, sysctl, cgroup, tuning]
published_at: 2026-07-06
---

> 这是 Linux 系列的第 23 篇——**性能与调试章节收尾**。前面教你"看"机器状态——这一篇教你**改**内核行为。

## 0. 默认参数是为"普遍场景"调的，不是为你

Linux 内核暴露了**几千个**可调参数。它们的默认值是为 1990 年代的桌面 / 服务器混合场景调的——拿到今天的"小机器跑高并发"场景里，**很多默认值过于保守**。

知道怎么调几个关键参数：

- 1G 机器的 TCP 并发上限能从 5K 提到 50K
- 慢日志的写入吞吐能翻倍
- 防御 SYN flood / 内存爆掉的能力加几个量级
- 容器的资源限制能精确到字节

---

## 1. `/proc/sys` 和 `sysctl`：双胞胎

`/proc/sys/` 是内核暴露的可调参数树：

```bash
$ ls /proc/sys/
abi  debug  fs  kernel  net  user  vm

# 进去逛逛
$ ls /proc/sys/net/ipv4/ | head
ip_forward
ip_local_port_range
tcp_syn_retries
tcp_keepalive_time
...

# 看某个值
$ cat /proc/sys/net/ipv4/ip_forward
0

# 改（临时，重启失效）
$ echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward
1
```

`sysctl` 是**同一件事的友好命令**：

```bash
# 路径里 / 换成 . 就是 sysctl key
$ sysctl net.ipv4.ip_forward
net.ipv4.ip_forward = 0

# 改
$ sudo sysctl -w net.ipv4.ip_forward=1

# 看全部
$ sudo sysctl -a | head

# 搜
$ sudo sysctl -a | grep tcp_tw
```

### 永久生效

写到 `/etc/sysctl.conf` 或 `/etc/sysctl.d/*.conf`：

```bash
$ sudo vim /etc/sysctl.d/99-myapp.conf
```

文件内容：

```ini
net.ipv4.ip_forward = 1
vm.swappiness = 10
fs.file-max = 1000000
```

加载：

```bash
$ sudo sysctl --system          # 加载所有 sysctl.d/*.conf
$ sudo sysctl -p                # 只加载 /etc/sysctl.conf
```

---

## 2. 常用的 10 个 sysctl（按场景）

### 网络：高并发服务器

```ini
# 端口耗尽防护（短连接多时关键）
net.ipv4.ip_local_port_range = 1024 65535

# TIME_WAIT 状态优化（HTTP 短连接场景）
net.ipv4.tcp_tw_reuse = 1                  # 重用 TIME_WAIT 端口（同方向）
net.ipv4.tcp_max_tw_buckets = 65536        # 最多 TW 队列

# 让 listen 队列大点（防短时连接被拒）
net.core.somaxconn = 65535                 # listen() 第二参数上限
net.ipv4.tcp_max_syn_backlog = 65535       # SYN 队列（半连接）

# TCP buffer（提高高延迟链路吞吐）
net.core.rmem_max = 16777216               # 16MB
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216    # min default max
net.ipv4.tcp_wmem = 4096 65536 16777216

# 防 SYN flood
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_synack_retries = 2

# 缩短 keepalive 让僵尸连接早死
net.ipv4.tcp_keepalive_time = 600          # 默认 7200（2 小时太长）
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 3

# 减少 fin wait
net.ipv4.tcp_fin_timeout = 15              # 默认 60
```

读法：`tcp_tw_reuse` 让你的服务器更容易复用 TIME_WAIT 状态的端口——**反向不行**（client 出门连同一目标的话仍然受限）。

### 内存：减少 swap 颠簸

```ini
# 多大概率使用 swap（0-100；越小越少 swap）
vm.swappiness = 10                          # 服务器推荐 10
# vm.swappiness = 60                        # 桌面默认

# 多少可用内存留给应急（OOM 时还能继续运行核心服务）
vm.min_free_kbytes = 65536

# 系统脏页（dirty page）刷盘策略——影响 fsync / write 延迟
vm.dirty_ratio = 10                         # 内存超 10% 是脏页时阻塞写
vm.dirty_background_ratio = 5               # 超 5% 开始后台刷
vm.dirty_expire_centisecs = 1000            # 脏页停留 10 秒后强制刷
```

### 文件系统 / 进程

```ini
# 全局打开文件数上限（默认 8K-1M 视发行版）
fs.file-max = 1000000

# 单进程能打开多少文件（被 ulimit -n 限制）
fs.nr_open = 1000000

# 内核 PID 范围（默认 32K 太小，容器多了就爆）
kernel.pid_max = 4194304

# 进程可以创建的 thread 数
kernel.threads-max = 65535
```

### 容器 / Docker 专属

```ini
# 让 iptables 看到容器流量（k8s/docker 必备）
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1                     # 路由功能
```

### 安全加固

```ini
# 防止 IP spoofing（rp_filter）
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# 忽略 ICMP redirect（防中间人）
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0

# 不允许源路由
net.ipv4.conf.all.accept_source_route = 0
```

---

## 3. ulimit：每个进程的资源上限

sysctl 是**全局**，ulimit 是**每个 shell session / 进程**。

```bash
# 看当前 shell 的所有限制
$ ulimit -a
core file size          (blocks, -c) 0
data seg size           (kbytes, -d) unlimited
file size               (blocks, -f) unlimited
open files                      (-n) 1024
max user processes              (-u) 15497
virtual memory          (kbytes, -v) unlimited

# 临时改（只影响本 shell）
$ ulimit -n 65536

# 跑测试
$ ulimit -n 65536; ./my-server
```

**`open files` 默认 1024** 是 90% 的"高并发服务器报 too many open files"根因。

### 永久改

```bash
$ sudo vim /etc/security/limits.conf
```

加：

```
# 用户         类型     项目         值
*              soft    nofile      65536
*              hard    nofile      65536
*              soft    nproc       65535
*              hard    nproc       65535
root           soft    nofile      65536
root           hard    nofile      65536
```

新登录的 shell 才生效。

### systemd 服务里改

systemd 不读 limits.conf，要在 .service 里写：

```ini
[Service]
LimitNOFILE=65536
LimitNPROC=65535
LimitCORE=infinity
```

---

## 4. cgroup：把进程关到资源笼子里

`cgroup`（control group）是 Linux 给进程**分配 / 限制资源**的内核机制。Docker / systemd / Kubernetes 全靠它实现"限内存 / 限 CPU"。

### cgroup v1 vs v2

- **v1**：每种资源（CPU / mem / blkio / pids）一棵独立树，配置繁琐
- **v2**：统一一棵树，更清晰。**现代发行版默认**（Fedora 31+, Ubuntu 22+）

看你机器哪个：

```bash
$ mount | grep cgroup
cgroup2 on /sys/fs/cgroup type cgroup2 ...     # ← v2
# 或者
tmpfs on /sys/fs/cgroup type tmpfs ...         # ← v1 多挂载点
```

### 手动建一个 cgroup（v2）

```bash
$ sudo mkdir /sys/fs/cgroup/myapp
$ ls /sys/fs/cgroup/myapp/
cgroup.controllers   cgroup.events       cgroup.freeze
cgroup.max.depth     cgroup.max.descendants  ...
memory.max           memory.current      memory.events
cpu.max              cpu.weight          cpu.stat
io.max               pids.max            ...

# 限制内存 256MB
$ echo "256M" | sudo tee /sys/fs/cgroup/myapp/memory.max

# 限制 CPU 50%（每 100ms 给 50ms）
$ echo "50000 100000" | sudo tee /sys/fs/cgroup/myapp/cpu.max

# 把进程加进来
$ echo $$ | sudo tee /sys/fs/cgroup/myapp/cgroup.procs
# 之后这个 shell 跑的所有东西都受限于这个 cgroup
```

### `systemd-run` 一键加 cgroup（推荐）

不用手动建——systemd 把每个 service 都放进自己的 cgroup：

```bash
# 一次性跑命令并限制资源
$ sudo systemd-run --uid=$USER --slice=myslice \
    --property=MemoryMax=256M \
    --property=CPUQuota=50% \
    --property=TasksMax=100 \
    bash -c 'stress --vm 1 --vm-bytes 500M'

# 用 systemd-cgtop 看资源占用
$ systemd-cgtop
```

这是给一次性测试 / 容器编排打底子的好工具。

### Docker 怎么用

Docker 跑容器时实际就在调 cgroup：

```bash
$ docker run --memory=256M --cpus=0.5 --pids-limit=100 alpine sh

# 看 docker 给容器加的 cgroup 限制
$ docker inspect <container> | grep -i 'memory\|cpu'
$ cat /sys/fs/cgroup/system.slice/docker-<id>.scope/memory.max
```

---

## 5. 内核模块（lsmod / modprobe）

很多内核功能（文件系统、网络驱动、加密算法）是以 **模块** 形式动态加载的：

```bash
# 看已加载的
$ lsmod | head
Module                  Size  Used by
btrfs                1740800  0
overlay               155648  56
xt_conntrack           16384  3
nf_conntrack          184320  6 xt_conntrack
...

# 加载某模块
$ sudo modprobe br_netfilter
$ sudo modprobe overlay

# 卸载（小心，正在用就拒绝）
$ sudo modprobe -r br_netfilter

# 开机自动加载：写到 /etc/modules-load.d/myapp.conf
$ echo 'overlay' | sudo tee /etc/modules-load.d/docker.conf
```

什么时候要手动 modprobe？最常见的是装 k8s / docker 前需要确保 `br_netfilter` 加载、确认 nf_conntrack table 大小够大。

---

## 6. 给"小机器跑高并发"的实战模板

如果你有一台 2G / 2vCPU 阿里云小机，想跑 nginx + 业务：

`/etc/sysctl.d/99-tuning.conf`:

```ini
# 文件描述符
fs.file-max = 1000000

# 网络 / TCP
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_max_tw_buckets = 65536
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_synack_retries = 2

# 内存
vm.swappiness = 10
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.overcommit_memory = 1                   # docker 推荐

# 安全
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
```

`/etc/security/limits.d/99-nofile.conf`:

```
*  soft  nofile  65536
*  hard  nofile  65536
```

```bash
$ sudo sysctl --system
$ sudo reboot      # limits 要重启或者重登录
```

跑完，**同样配置的 nginx 能扛的并发连接 3-5 倍**。

---

## 7. 调参 vs 升机器：怎么取舍

调参不是万能药。**先看瓶颈在哪**（参考 [21 observability](observability)）：

- CPU 满了 → 调参没用，加核 / 优化代码
- 内存满了 → 调 swappiness 能撑一阵，根治要加内存
- 单端口耗尽 / port reuse → **调 sysctl 立刻见效**
- file descriptor 满 → **调 ulimit + fs.file-max 立刻见效**
- TCP buffer 太小拖慢长距离传输 → 调 sysctl 立刻见效

经验：

> **调内核参数最适合解决"明明硬件够，但默认设置限制了它"的场景**。硬件确实不够的话——加机器、加内存最快。

---

## 8. 调参常踩的坑

### 坑 1：tcp_tw_recycle 已经被删

老教程会说 `net.ipv4.tcp_tw_recycle=1`——**这个参数 4.12 内核已经移除**！它跟 NAT 环境严重不兼容。**绝对不要在新机器加这条**。

### 坑 2：vm.overcommit_memory

```
0 = 启发式（默认，常用）
1 = 总是 allow（redis / docker 推荐）
2 = 严格不超 overcommit_ratio
```

设 0 时大内存分配可能被拒绝（"Cannot allocate memory"）；redis 启动会警告，要 `=1`。

### 坑 3：file-max 改了但应用没生效

应用读 `ulimit -n`，跟 `fs.file-max` 是两层：

- `fs.file-max`：**全系统**最多打开多少文件（影响所有进程）
- `ulimit -n`：**当前 session / 进程**能打开多少

**两个都要改**才生效。

### 坑 4：写完没 reload

```bash
$ sudo sysctl -p                 # 加载 /etc/sysctl.conf
$ sudo sysctl --system           # 加载 /etc/sysctl.d/*.conf
```

---

## 9. 看哪些参数已经被改过

```bash
# 看跟默认不一样的
$ sudo sysctl -a | diff <(sudo sysctl -a) /dev/null
# 不太好用，更实际：

# 看 sysctl 配置文件
$ ls /etc/sysctl.d/
$ sudo grep -h '^[^#]' /etc/sysctl.d/*.conf /etc/sysctl.conf
```

接手别人的机器时这条很有用——快速看"前任怎么调的"。

---

## 10. 现在做一件事

```bash
# 1. 看你机器关键的几个参数
$ sysctl net.core.somaxconn vm.swappiness fs.file-max kernel.pid_max
$ ulimit -n

# 2. 看你机器有没有被调过
$ sudo grep -h '^[^#]' /etc/sysctl.d/*.conf 2>/dev/null | head

# 3. 看 cgroup 状态
$ mount | grep cgroup
$ ls /sys/fs/cgroup/system.slice/ | head

# 4. 看你应用 / docker 实际占了多少
$ systemd-cgtop -n 1

# 5. 如果是个小机器跑服务，抄上面那份"高并发模板"试一下
$ sudo tee /etc/sysctl.d/99-tuning.conf > /dev/null <<'EOF'
（粘贴模板）
EOF
$ sudo sysctl --system
```

调参是个**实验性**工作——改一项，跑压测 / 监控半天，看有没有效。不要一次性 50 个参数全开——出了问题不知道是谁干的。

---

> **下一篇**：[containers-inside](containers-inside)——Docker 容器到底是什么？Namespace / cgroup / overlayfs / capabilities，四块拼图拼出"容器"这个概念。
