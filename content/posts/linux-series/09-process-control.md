---
slug: process-control
title: 进程管理：ps / top / kill / jobs / nohup 全套基本动作
summary: Linux 系列第 9 篇。进程是 Linux 一切的基本单位——shell、网页、AI 推理、数据库都跑在进程里。这一篇拆"看进程、杀进程、把进程放后台、让进程脱离终端继续跑"四组日常动作，并把 SIGKILL / SIGTERM 这种信号术语彻底讲清。
tags: [linux, linux-series, process, ps, top, kill, signal]
published_at: 2026-06-22
---

> 这是 Linux 系列的第 9 篇。你日常 80% 的运维操作可以归成一句话——"看进程、跟进程互动"。这篇把所有相关动作梳理一遍。

## 0. 一台跑着的 Linux 此刻有多少进程？

```bash
$ ps -ef | wc -l
237
```

一台普通服务器轻松 200+ 进程同时跑。它们怎么组织？谁是谁的爹？谁占了多少 CPU？这一篇把这些动作都教给你。

---

## 1. `ps`：看进程，**两种**风格记一种就够

`ps` 是历史古董，**有两套互不兼容的参数风格**：

```bash
# BSD 风：不带横杠
$ ps aux

# UNIX 风：带横杠
$ ps -ef

# 这两条都是"显示所有进程"，但输出格式略有差异
```

**记一种**就行，`ps aux` 是最常用的（输出列更人性化）：

```
USER  PID  %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root    1   0.0  0.4 168568 12808 ?        Ss   Apr20   0:21 /sbin/init
root    2   0.0  0.0      0     0 ?        S    Apr20   0:00 [kthreadd]
www    91   0.5  2.1  72340 16240 ?        S    10:23   0:13 nginx: worker
me   2341   2.3  4.7 845232 38120 pts/0    Sl+  11:02   0:42 python app.py
```

每列含义：

| 列 | 含义 |
|---|---|
| USER | 谁起的（uid） |
| PID | 进程号 |
| %CPU | 占了多少 CPU（瞬时） |
| %MEM | 占了多少物理内存 |
| VSZ | 虚拟内存大小（KB） |
| RSS | 实际物理内存（KB）← **看这个判断真实占用** |
| TTY | 关联的终端，`?` 表示无（守护进程） |
| STAT | 状态（见下表） |
| TIME | 累计 CPU 时间（不是 wall clock） |
| COMMAND | 命令行 |

### STAT 状态字符

```
R  running 或 ready（在跑或在 ready queue）
S  sleeping（绝大部分进程都是这个——等 I/O 或事件）
D  uninterruptible sleep（卡在 I/O，kill 不动，多见于 NFS 挂掉）
T  stopped（被 SIGSTOP 暂停了）
Z  zombie（已经死了但爹没收尸）
+  在前台进程组
s  session leader
l  multi-threaded
```

看到 D 状态进程 + kill 不掉 → 多半磁盘 / 网络 I/O 卡了，要查 `dmesg`。

### 实用筛选

```bash
# 找某个进程
$ ps aux | grep nginx

# 更聪明的 pgrep（不用 grep + grep 自身那一行）
$ pgrep nginx
$ pgrep -af nginx       # 显示完整 cmd
$ pgrep -u me           # 我起的所有进程

# 显示进程树
$ ps auxf               # f 显示父子关系
$ pstree                # 更直观（要装）
$ pstree -p             # 显示 pid

# 按 CPU 排序，前 10
$ ps aux --sort=-%cpu | head -10

# 按内存排序
$ ps aux --sort=-rss | head -10
```

---

## 2. `top` / `htop`：实时观察

`ps` 是**快照**，`top` 是**视频**。

```bash
$ top
```

默认每 3 秒刷一次。键盘交互：

| 键 | 作用 |
|---|---|
| `q` | 退出 |
| `P` | 按 CPU 排序 |
| `M` | 按 MEM 排序 |
| `T` | 按累计时间 |
| `1` | 显示每个 CPU 核（默认只显示汇总） |
| `c` | 显示完整 command line |
| `k` | 杀进程（输入 pid） |
| `r` | renice（改优先级） |
| `f` | 选要显示的列 |
| `u` | 只看某用户 |

### htop：top 的现代版（强烈推荐）

```bash
$ sudo apt install htop      # 或 brew install htop
$ htop
```

彩色、进程树、鼠标可点、F 键菜单——比 top 友好 10 倍。我自己开服务器第一件事就是装 htop。

### 一行版（适合脚本）

```bash
# 当前最吃 CPU 的 5 个进程
$ ps -eo pid,user,%cpu,%mem,command --sort=-%cpu | head -6

# 当前最吃内存的 5 个
$ ps -eo pid,user,%cpu,rss,command --sort=-rss | head -6
```

---

## 3. `kill` 和信号

`kill` 这名字误导——它**不是**只用来"杀"，它是"**给进程发信号**"。

```bash
$ kill <pid>          # 默认发 SIGTERM (15)
$ kill -9 <pid>       # 发 SIGKILL (9)
$ kill -HUP <pid>     # 发 SIGHUP (1)
$ kill -l             # 列出所有信号
```

### 信号字典（背 4 个就够）

| 信号 | 数字 | 行为 |
|---|---|---|
| **SIGTERM** | 15 | "请优雅退出" — **默认**，进程能 catch、可以清理 |
| **SIGINT** | 2 | "Ctrl+C"，等价于 SIGTERM 但语义更"用户主动取消" |
| **SIGHUP** | 1 | 历史上"终端关了"，今天通常用来"重新加载配置"（nginx -s reload） |
| **SIGKILL** | 9 | **不能 catch** — 内核硬杀进程。**用于 SIGTERM 不管用时的最后手段** |
| SIGSTOP | 19 | 暂停（Ctrl+Z），不能 catch |
| SIGCONT | 18 | 继续被暂停的进程 |
| SIGUSR1/2 | 10/12 | 应用自定义信号（很多 server 用它触发 dump） |

### `kill -9` 不是首选

新手最爱 `kill -9`，但**它跳过了进程清理逻辑**：

- 打开的文件没刷盘（数据可能丢）
- 子进程变孤儿
- 锁文件没删（下次启动可能误判"已经在跑"）

**正确顺序**：

```bash
$ kill <pid>            # 先优雅
$ sleep 5
$ kill -0 <pid>         # -0 不发信号，只查在不在
$ kill -9 <pid>         # 还在才硬杀
```

### `pkill` / `killall`：按名字杀

```bash
$ pkill nginx               # 杀所有名为 nginx 的
$ pkill -f 'python app.py'  # 按完整 command line 匹配
$ pkill -u me               # 杀某用户所有进程

$ killall chrome            # 同上，老牌工具
```

**注意 `-9` 配合 `pkill -f` 是日常救火神器**——但要先 `pgrep -af 'pattern'` 确认匹配到的是不是你想要的。

---

## 4. 前台 / 后台 / 暂停

### `&`：直接放后台

```bash
$ long-task &
[1] 12345                   # [作业号] PID
$ jobs                       # 看当前 shell 的后台任务
[1]+  Running    long-task &
```

### `Ctrl+Z`：把前台任务暂停

```bash
$ vim file
^Z                           # 按 Ctrl+Z
[1]+  Stopped    vim file
$ jobs
[1]+  Stopped    vim file

$ bg                         # 让它在后台继续
$ fg                         # 调回前台
$ fg %1                      # 按作业号调回
```

### 实战：远程跑长任务一定要会的

```bash
# 跑长任务，临时离开几分钟
$ python train.py
^Z                # 暂停
$ bg              # 放后台
$ disown          # 跟当前 shell 解绑（关 shell 它也活）
```

`disown` 是关键——不 disown 的话 shell 退出（SIGHUP）会传给所有子进程。

---

## 5. `nohup` 和 `nohup &`：让进程脱离终端

跑长任务（机器学习、备份、爬虫）想让它**关了 SSH 还继续跑**，最朴素的方式：

```bash
$ nohup python train.py > train.log 2>&1 &
```

拆解：

- `nohup` → 忽略 SIGHUP（终端关闭时的"挂断"信号）
- `python train.py` → 主命令
- `> train.log 2>&1` → stdout/stderr 都进文件（不然 nohup 默认写 nohup.out）
- `&` → 后台跑

跑完关闭 ssh，几小时后回来看 `train.log`，结果在。

### 更现代的替代品：`tmux` 或 `screen`

`nohup` 适合"扔出去一次性任务"。但如果你**还想随时回来看进度**——用 `tmux`：

```bash
# 在 server 上
$ tmux new -s train         # 新建一个名为 train 的会话
（在里面跑你的命令）
（按 Ctrl+B d 脱离会话）

# 重新连
$ tmux attach -t train
```

tmux 是"远程 ssh 必备 + 防断网神器"。值得专门花一晚上学。

---

## 6. `nice` / `renice`：调整优先级

CPU 紧张时，让某些任务**让一让**：

```bash
# 启动时设低优先级（占了别人不用的 CPU 才跑）
$ nice -n 19 ./big-build.sh   # 范围 -20 (最高) 到 19 (最低)

# 对已经在跑的进程改优先级（要 root 才能提优先级，普通用户只能降）
$ sudo renice -n 5 -p 12345
```

经验：备份、视频编码、ML 训练这种"占着 CPU 不嫌多但不急"的任务，`nice -n 10` 起跑，主进程吃 CPU 时它会自动让。

### `ionice`：磁盘 I/O 优先级

```bash
$ ionice -c 3 ./backup.sh     # -c 3 = idle 模式（只在磁盘空闲时跑）
```

夜里跑大备份用这个，白天的请求受影响最小。

---

## 7. `time`：测某个命令到底跑多久

```bash
$ time ./script.sh
real    0m12.345s            # wall clock 实际耗时
user    0m3.210s             # 用户态 CPU 时间
sys     0m0.890s             # 内核态 CPU 时间
```

`user + sys` 远小于 `real` → 主要在等 I/O（磁盘、网络）。
`user` 接近 `real` → 在 CPU 上算东西。

调性能时第一个该跑的命令。

---

## 8. 一些"奇怪"的高频小工具

```bash
# 看某进程打开了哪些文件 / socket
$ lsof -p 12345

# 反向：哪个进程占了某端口？
$ sudo lsof -i :8080
$ sudo ss -lntp | grep 8080

# 看某文件被谁打开了
$ lsof /var/log/app.log

# 实时跟踪某个进程的 syscall
$ sudo strace -p 12345

# 看进程在哪些 CPU 核上跑
$ taskset -p 12345

# 把进程绑到指定核
$ taskset -c 0,1 ./mycommand
```

特别是 `lsof -i :port` 这条——"端口被谁占了"的标准答案。

---

## 9. 现在做一件事

跟着敲：

```bash
# 1. 看你机器现在最吃 CPU 的进程
$ ps aux --sort=-%cpu | head -5

# 2. 启动一个长跑任务，扔后台
$ sleep 600 &
$ jobs

# 3. 看你刚启动的那个 sleep 在哪
$ pgrep sleep

# 4. 优雅杀掉
$ pkill sleep

# 5. 看你 shell 本身的进程信息
$ cat /proc/$$/status | head -15
```

跑完你就有了"操控进程"的完整工具集——剩下都是在不同场景里把这些动作组合起来。

---

> **下一篇**：[shells-rcfile](shells-rcfile)——`.bashrc / .zshrc / PATH / alias / 函数 / 自动补全`，怎么把 shell 从"能用"调到"顺手到飞起"。
