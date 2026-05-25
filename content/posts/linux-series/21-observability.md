---
slug: observability
title: 机器在干什么：top / vmstat / iostat / strace 的实战分工
summary: Linux 系列第 21 篇。"服务器卡了"——你想 5 分钟内定位是 CPU / 内存 / 磁盘 / 网络 / 还是某个进程的锅。本篇按"4 个资源维度"拆开常用 10 个观测工具，给一份"USE 方法"清单，让你从慌乱排查变成系统化判断。
tags: [linux, linux-series, observability, top, strace, iostat, performance]
published_at: 2026-07-04
---

> 这是 Linux 系列的第 21 篇，进入**性能与调试**章节。前面教你怎么"用"Linux——这一篇讲怎么"看穿"它的状态。

## 0. 别再"先 top 看一眼"了

很多人遇到"机器慢"第一反应是 `top` —— 然后看半天不知道找什么。

性能工程师 Brendan Gregg 提出过一个简单的方法叫 **USE**（Utilization / Saturation / Errors）：

> **对每一类资源，问 3 个问题**：
> - 它用了多少？（utilization）
> - 它排队 / 等待了吗？（saturation）
> - 它有错吗？（errors）

四大资源：

| 资源 | utilization | saturation | errors |
|---|---|---|---|
| CPU | %us + %sy | runq（等运行的进程数） | thermal throttle |
| 内存 | used | swap 用量 / page in-out | OOM killed |
| 磁盘 | %util | await（队列） | I/O errors |
| 网络 | 带宽 % | TCP retrans / drops | NIC errors |

下面按资源讲怎么看。

---

## 1. CPU：用了多少 + 排队没

### `top` / `htop` —— 综合视图

```bash
$ top
top - 14:22:33 up 5 days,  load average: 2.34, 1.85, 1.42
Tasks: 234 total,   2 running, 232 sleeping
%Cpu(s): 35.2 us,  4.1 sy,  0.0 ni, 58.3 id,  2.1 wa,  0.0 hi,  0.3 si
MiB Mem :   2007.4 total,    102.1 free,   1234.5 used,    670.8 buff/cache
```

读 `%Cpu(s)` 那行（按 `1` 显示每核）：

| 字段 | 含义 |
|---|---|
| **us** (user) | 用户态进程吃 CPU |
| **sy** (system) | 内核态（syscall / 中断处理）吃 CPU |
| **ni** (nice) | 低优先级进程 |
| **id** (idle) | 空闲 |
| **wa** (iowait) | **CPU 在等磁盘**（idle 但不算 idle） |
| **hi** | 硬中断 |
| **si** | 软中断 |
| **st** (steal) | 虚拟机被宿主机偷走的时间 |

**关键诊断点**：

- `us` 高 + `sy` 低 → 业务进程算东西多，是 CPU bound 工作负载
- `us` 低 + `sy` 高 → 大量 syscall（fork / context switch / 锁竞争），可能写法有问题
- **`wa` 高** → **磁盘瓶颈**（CPU 在等 I/O 不能动）
- `st` 高 → 云上 CPU 被超卖

### Load average：等运行的进程数

```
load average: 2.34, 1.85, 1.42
              1min  5min  15min
```

**load = 在 CPU 上跑 + 在 ready queue 等 CPU + 在 D 状态等 I/O** 的进程数（1/5/15 分钟平均）。

经验法则：

- load < CPU 核数 → 资源充裕
- load ≈ 核数 → 满载（接近最佳吞吐）
- load > 核数 × 2 → 在排队，要扩

> **细节**：Linux 的 load 跟其他 Unix 不同，**包含 D 状态进程**（uninterruptible I/O 等待）。所以 load 高有时是磁盘卡了不是 CPU 忙。

```bash
# 看 1 分钟 load
$ cat /proc/loadavg
2.34 1.85 1.42 2/234 12345
   ↑   ↑   ↑   ↑       ↑
   1m 5m 15m running/total  最近 PID

# uptime 也显示
$ uptime
 14:22:33 up 5 days, load average: 2.34, 1.85, 1.42
```

### 看每个进程的 CPU

```bash
$ ps -eo pid,user,%cpu,cmd --sort=-%cpu | head
# 或 htop 交互式
$ htop
```

### 看 CPU 干啥用的 syscall（深入）

```bash
# 单进程：什么 syscall 最多
$ sudo strace -c -p <pid>
（让它跑一会儿 Ctrl+C）
% time     seconds  usecs/call  calls    syscall
 89.45    1.234567       5000      247    epoll_wait
  4.20    0.058091         12     4841    read
  ...
```

`epoll_wait` 占 89% → 程序大部分时间在等事件（正常的 server）。
`read / write` 占大头 → I/O 密集。
某个奇怪 syscall 占大头 → 可能是 bug。

---

## 2. 内存：物理 + swap + cache

### `free -h`

```bash
$ free -h
              total   used   free   shared  buff/cache  available
Mem:          2.0Gi  1.2Gi  102Mi    16Mi      670Mi    700Mi
Swap:         1.0Gi    0B   1.0Gi
```

**新手最容易看错**：`used` 看起来很高 → 但 Linux 故意把"剩下的"全用作 disk cache（**buff/cache**），需要时立刻让出来。

**真正能用的内存**看 `available`——不是 `free`。

- `total` 总物理内存
- `used` 进程 + 内核 + 不可回收的（buffers）
- `free` 真的空闲（很少有）
- `buff/cache` 文件 cache + 元数据 cache（可回收）
- `available` ≈ `free` + `buff/cache` 中可回收的部分 → **这才是"差不多能给新进程用的"**
- `Swap used` → 已经在 swap 的页数；> 0 不一定坏，但持续涨 = 内存压力大

### `vmstat`：实时刷新

```bash
$ vmstat 1                    # 每 1 秒刷一次
procs ---memory------ -swap- -io-- -system-- ----cpu----
 r  b   swpd   free   buff  cache   si   so   bi   bo   in   cs us sy id wa
 1  0      0  18632  10024 580120    0    0    2    8   45  120  8  2 90  0
 2  0      0  18504  10024 580120    0    0    0   24   88  211 25  4 71  0
```

关键列：

| 列 | 含义 |
|---|---|
| `r` | 在运行 / ready 的进程数（**> CPU 核数 = 在排队**） |
| `b` | D 状态阻塞进程数（**通常等磁盘**） |
| `si` / `so` | swap in / out KB/s（**应该是 0；持续非 0 = 物理内存不够**） |
| `bi` / `bo` | block in / out（磁盘读写 KB/s） |
| `in` / `cs` | 每秒中断数 / context switch 数（**异常高 = 锁竞争或频繁 fork**） |
| `wa` | iowait |

`vmstat 1` 看 30 秒 → 你对机器"现在大致在干什么"就有判断。

### 谁吃了内存

```bash
$ ps -eo pid,user,%mem,rss,cmd --sort=-rss | head
PID    USER  %MEM    RSS  CMD
12345  me    23.4  478752  python big_data_job.py
891    www-data  3.4  68000  nginx: worker
...

# 加权重看：RSS 是物理常驻内存
$ smem -tk                   # 比 ps 更准（区分 USS / PSS / RSS），要装
```

**RSS** 是该进程实际占的物理内存（包含共享库占的部分会重复算）。**PSS / USS** 更精确，看每个进程"独占"了多少。

### OOM Kill 留下的痕迹

机器内存撑爆，内核会挑一个进程 SIGKILL：

```bash
$ dmesg -T | grep -i 'killed process'
[Tue May 25 14:22:33] Out of memory: Killed process 12345 (java) total-vm:8GB...

$ journalctl -k | grep -i 'oom'
```

或者更现代：

```bash
$ journalctl --since today | grep -i oom-kill
```

OOM 来过 → 你机器内存严重不足，要加 / 减负 / 加 swap。

---

## 3. 磁盘 I/O：用了多少 + 排队没

### `iostat`：磁盘吞吐 + 延迟

```bash
$ iostat -xz 1            # -x 详细 -z 跳过 0 利用率的
Device   r/s    w/s    rkB/s   wkB/s  await  %util
sda     12.0    34.0   480     1360    2.3    5.2
nvme0n1  3.0   124.0   200    8120    0.8   92.1
                                       ↑     ↑
                                       延迟  利用率
```

关键列：

- **`%util`**：磁盘有多少时间在忙 —— **持续 > 80% = 磁盘瓶颈**
- **`await`**：每个 I/O 平均等待时间（ms）—— **HDD > 50ms / SSD > 10ms = 不健康**
- `r/s w/s`：每秒读 / 写次数（IOPS）
- `rkB/s wkB/s`：每秒读 / 写 KB

### `iotop`：哪个进程在 I/O

```bash
$ sudo iotop -oP                    # 只看有 I/O 的进程
Total DISK READ : 0.00 B/s | Total DISK WRITE : 24.50 M/s
  PID  PRIO  USER  DISK READ  DISK WRITE  COMMAND
12345  be/4  pg    0.00 B/s   18.5 M/s    postgres: walwriter
...
```

跟 `top` 类似，但按 I/O 排序。

### 磁盘队列深度长度

```bash
$ iostat -x 1 | awk 'NR>3{print $1, $9}'    # avgqu-sz
sda 0.12          # 平均队列长度
nvme0n1 4.5       # ← 排队 4.5 个，磁盘吃力
```

队列长 = 应用发起 I/O 比磁盘处理快。

---

## 4. 网络：流量 + 包率 + 错误

### `ifstat` / `sar -n DEV`

```bash
$ sar -n DEV 1
Linux ...
14:22:33  IFACE    rxpck/s   txpck/s   rxkB/s   txkB/s   rxerr/s
14:22:34  eth0     1234.0    2345.0    2048.0   8192.0    0.00
14:22:34  lo         12.0      12.0       1.5      1.5    0.00
```

- `rxkB/s` `txkB/s`：流量
- `rxpck/s` `txpck/s`：包率（很高时 CPU 处理中断会成为瓶颈）
- `rxerr/s` `txerr/s`：**应该是 0**——非 0 表示物理层或驱动问题

### `ss -s`：socket 统计

```bash
$ ss -s
Total: 245 (kernel 0)
TCP:   189 (estab 87, closed 90, orphaned 0, synrecv 0, timewait 89/0)

Transport Total  IP    IPv6
RAW       0     0      0
UDP       12    8      4
TCP       99    95     4
INET      111   103    8
```

- `timewait 89` 多 = 频繁的短连接
- `estab` 高 = 长连接多

### TCP retransmission（异常重传）

```bash
$ ss -s -i             # 加 -i 看每个连接的 RTT / cwnd
$ ss -tinp 'state established' | head

# 全局统计
$ netstat -s | grep -iE 'retrans|drop|reject'
    1234 segments retransmitted
    56 packets pruned from out-of-order queue
    23 retransmits in slow start
```

retrans 占总 segments **> 1% 就有网络问题**。

### 当前最忙的连接

```bash
$ ss -tn -o state established '( dport = :443 or sport = :443 )' | head
```

---

## 5. `strace`：跟踪单进程的 syscall

```bash
# 跟着一个跑着的进程
$ sudo strace -p 12345

# 看哪类 syscall 最多（统计模式）
$ sudo strace -c -p 12345

# 跟随 fork 出去的子进程
$ sudo strace -f -p 12345

# 看 OS 在干什么 I/O（filter 文件相关）
$ sudo strace -e trace=openat,read,write -p 12345

# 看时间戳
$ sudo strace -tt -p 12345

# 写到文件不刷屏
$ sudo strace -o /tmp/strace.log -p 12345
```

**典型用法**：

- "应用慢但 CPU/mem 都不高" → strace 看它卡在哪个 syscall
- "应用启动失败" → strace 看 open 哪个文件 ENOENT
- "应用读不出某配置" → strace -e openat 看它去哪找

**性能代价**：strace 会让进程慢 5-50x（每个 syscall 都被 ptrace 拦截）。**生产环境慎用**，要看更快的工具用 `perf` 或 `bpftrace`。

---

## 6. `perf`：内核级性能采样（高阶）

```bash
# 看哪个函数占 CPU 最多（30 秒采样）
$ sudo perf top

# 抓 30 秒 + 生成报告
$ sudo perf record -ag sleep 30
$ sudo perf report

# 火焰图（要装 FlameGraph 工具）
$ sudo perf script | flamegraph.pl > flame.svg
```

perf 是终极 CPU 调试器，但学习曲线陡。**先掌握上面 5 个工具 + 偶尔翻 perf**。

---

## 7. `bpftrace` / `eBPF` 一句话扫盲

eBPF 是 Linux 4.x+ 的"内核内安全脚本引擎"——可以在不重启的情况下，往内核插小程序观察一切：

```bash
# 看哪些进程在调 open()
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s\n", comm); }'

# 看哪些进程在 fork
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_clone { printf("%s\n", comm); }'
```

`bpftrace` 命令的开销几乎为 0，**生产环境可用**，是 strace 的现代替代。

太大的话题，留给以后专门讲。这里只让你知道**有这条路**。

---

## 8. 一份"5 分钟诊断清单"

机器慢的时候，按这个顺序敲：

```bash
# 1. uptime + load + 进程数（30 秒判断"忙不忙"）
$ uptime
$ ps aux | wc -l

# 2. CPU 角度
$ top -bn1 | head -15
# 或更全
$ vmstat 1 3

# 3. 内存
$ free -h
$ dmesg -T | grep -i kill | tail

# 4. 磁盘
$ iostat -xz 1 3
$ df -h
$ df -i

# 5. 网络
$ ss -s
$ ip -s link

# 6. 谁占了 CPU / 内存
$ ps -eo pid,user,%cpu,%mem,rss,cmd --sort=-%cpu | head
$ ps -eo pid,user,%cpu,%mem,rss,cmd --sort=-rss | head

# 7. 看现在 I/O 在等的进程
$ ps -eo state,pid,cmd | awk '$1 ~ /D/'

# 8. 最近的内核错误
$ dmesg -T | tail -30
```

**5 分钟内**你应该能定位到瓶颈在哪个维度（CPU / mem / disk / net）。

---

## 9. 工具速查总图

```
┌─ CPU ────────────────────────────────────────┐
│  概览：top / htop                              │
│  长时间趋势：sar -u                            │
│  按进程：ps --sort=-%cpu / top -p             │
│  syscall：strace / perf / bpftrace            │
│  上下文切换：vmstat 看 cs                       │
└──────────────────────────────────────────────┘

┌─ 内存 ────────────────────────────────────────┐
│  概览：free -h                                 │
│  趋势：sar -r                                  │
│  按进程：ps --sort=-rss / smem                 │
│  OOM：dmesg / journalctl -k                    │
│  swap：vmstat 看 si/so                         │
└──────────────────────────────────────────────┘

┌─ 磁盘 ────────────────────────────────────────┐
│  IOPS / 延迟：iostat -xz 1                      │
│  按进程：iotop                                 │
│  空间：df -h / df -i / du -sh                  │
│  错误：dmesg / smartctl                        │
└──────────────────────────────────────────────┘

┌─ 网络 ────────────────────────────────────────┐
│  流量：sar -n DEV / ifstat                      │
│  socket：ss -s / ss -tlnp                      │
│  错误：netstat -s / ip -s link                  │
│  抓包：tcpdump / wireshark                     │
└──────────────────────────────────────────────┘
```

---

## 10. 现在做一件事

```bash
# 1. 装 htop（如果没装）
$ sudo apt install htop iotop sysstat

# 2. 跑一遍上面"5 分钟清单"，看你机器现在什么样
$ uptime
$ vmstat 1 3
$ iostat -xz 1 3
$ free -h
$ ss -s

# 3. 看你机器 5 天来最忙的时段（要装 sysstat / sa）
$ sar -u | head -20
# CPU
$ sar -r          # 内存
$ sar -d          # 磁盘
$ sar -n DEV      # 网络

# 4. 抓 30 秒 strace 看你 shell 在干什么
$ strace -c -p $$ &
$ sleep 30; kill %1
```

练熟这套工具，你看任何"机器卡了"都能在几分钟内有答案。

---

> **下一篇**：[logs](logs)——`journalctl / syslog / logrotate`，日志去哪了、怎么不爆磁盘、出问题怎么 5 秒找到关键 log。
