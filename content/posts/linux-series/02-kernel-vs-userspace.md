---
slug: kernel-vs-userspace
title: 内核与用户态：你的 `ls` 怎么走到硬盘上的
summary: Linux 系列第 2 篇。操作系统不是"一坨"代码，而是分两层——内核（kernel）住 CPU 特权环 0，用户程序住环 3，中间靠 syscall 通信。理解这一刀划在哪，你后面所有的"权限""保护""容器""调优"都会变得直观。
tags: [linux, linux-series, kernel, syscall, 内核]
published_at: 2026-06-15
---

> 这是 Linux 系列的第 2 篇。上一篇讲了 Linux 为什么赢，这一篇讲它**长什么样**——从你敲一条命令到机器干完活，中间发生了什么。

## 0. 一个看似简单的问题

你打开终端敲了 `ls`，回车，得到一个文件列表。这件"日常到不能再日常"的小事，机器内部到底走了几步？

```
$ ls
README.md  src/  package.json
```

直觉答案：**`ls` 程序读了硬盘，把结果打印出来**。

真实答案：**`ls` 程序根本碰不到硬盘**。它跟一个叫"内核"的东西说"我想读这个目录"，内核才去碰硬盘。这中间的"说"——就是 syscall。

这篇就把这层窗户纸捅破。

---

## 1. 操作系统是夹在你和硬件之间的"代理人"

想象你写程序时如果没有操作系统，会是什么样：

- 想读磁盘？自己写 ATA / NVMe 协议、自己处理中断
- 想发网络包？自己写 TCP / IP / 网卡驱动
- 想在屏幕画字？自己驱动 GPU
- 别的程序也在跑？自己跟它协调内存、CPU、外设

你会疯掉。OS 出现的意义就是：**把硬件的复杂封进一个统一接口，再公平地分给所有应用使用**。

```
┌────────────────────────────────────────┐
│  应用程序：bash / ls / vim / curl / chrome   │  ← 这里是你写的代码
├────────────────────────────────────────┤
│  系统调用（syscall）边界 ━━━━━━━━━━━━━━━━━ │  ← 唯一允许的过桥点
├────────────────────────────────────────┤
│  内核：进程调度 / 内存管理 / 文件系统 / 网络栈 │  ← Linus 管的那一坨
├────────────────────────────────────────┤
│  硬件抽象（驱动）                          │
├────────────────────────────────────────┤
│  CPU / 内存 / 磁盘 / 网卡 / GPU             │  ← 真正干活的物理东西
└────────────────────────────────────────┘
```

这条 syscall 边界**不是程序员画在白板上的虚线**——它是 **CPU 硬件强制执行**的真分界线。

---

## 2. CPU 的"特权环"：内核为什么动得了硬件

x86 CPU 有 4 个特权级，从 ring 0（上帝模式）到 ring 3（普通模式）。Linux 只用了两个：

| 环 | 谁住这里 | 能做什么 |
|---|---|---|
| ring 0（kernel mode）| Linux 内核、驱动 | 全部 CPU 指令、直接访问硬件、改页表、关中断、读所有内存 |
| ring 3（user mode） | 你的 ls / bash / chrome | **不能**直接 I/O、**不能**读别的进程内存、**不能**改页表 |

ring 3 想干 ring 0 的事——CPU 立刻甩一个异常给内核，内核会优雅地告诉你 "Segmentation fault"（段错误）或 "Operation not permitted"。

**这就是 Linux 安全的根**：

- 你写的程序就算崩了，**碰不到内核**
- 别的用户的进程就算被黑了，**碰不到你的内存**
- 容器跑垮了，**碰不到宿主机**

ring 0 这把锁不是软件能绕过的——是硅片上焊死的。

---

## 3. Syscall：从环 3 跳到环 0 的唯一合法通道

那你的程序想读文件、发网络包、起新进程，怎么办？答：**叫内核帮你做**。叫的方式叫 **syscall**（系统调用）。

x86_64 下，syscall 是一条 CPU 指令 `syscall`：

1. 用户进程把"我要做什么"（syscall 编号）放到 `rax` 寄存器
2. 参数放到 `rdi, rsi, rdx, r10, r8, r9`
3. 执行 `syscall` 指令
4. CPU 切到 ring 0，跳到内核预设的入口
5. 内核根据 `rax` 找到对应的处理函数（如 `sys_read`）
6. 内核去碰硬件、做事、把结果填回寄存器
7. 内核执行 `sysret`，切回 ring 3，进程拿到结果继续跑

这一切发生在**几百纳秒**内——你完全没感觉。

### `ls` 一次到底有几次 syscall？

直接用 `strace` 实地观察（strace 拦截所有 syscall 并打印）：

```bash
$ strace -c ls > /dev/null
```

`-c` 是统计模式，跑完会出表：

```
% time     seconds  usecs/call  calls  errors syscall
------ ----------- ----------- ------ ------- --------
 23.45    0.000124           7      18         openat
 18.20    0.000096           5      19         close
 12.10    0.000064           3      21         read
 10.50    0.000055           4      14         mmap
  8.31    0.000044           5       8         fstat
  ...
------ ----------- ----------- ------
                              175         total
```

光是 **`ls` 一次就发了 175 次 syscall**。其中：

- `openat` 18 次 → 打开当前目录、各种动态链接库（libc.so 等）
- `read` 21 次 → 实际读目录的 entry
- `write` 几次 → 把结果写到 stdout
- `close` 19 次 → 关闭文件描述符

每一次都是一次**用户态 → 内核态 → 用户态**的小切换。

### 关键 syscall 速览（认得这些后面看 strace 会顺很多）

```
进程：fork / clone / execve / exit / wait / kill
文件：open / openat / read / write / close / lseek / stat
内存：mmap / munmap / brk
网络：socket / bind / listen / accept / connect / send / recv
信号：signal / sigaction / kill
时间：gettimeofday / clock_gettime / nanosleep
```

Linux 全部 syscall 约 **400 个**（`man syscalls` 全列）。日常 90% 的事情十几个就够了。

---

## 4. 用户态和内核态的"内存隔离"

不止 CPU 指令分级，**内存空间**也分两边：

```
高地址  ┌─────────────────────────┐
        │  内核空间（kernel space） │  ← 进程看不到，访问就 segfault
        ├─────────────────────────┤  ← 64 位上这条线大约在 0xFFFF800000000000
        │                         │
        │  用户进程的内存（user）   │  ← 这就是你的程序的全部世界
        │                         │
低地址  └─────────────────────────┘
```

每个用户进程都有自己的 0~`0xFFFF800000000000` 这一大段虚拟地址空间，互相隔离。**进程 A 写 0x1000 跟进程 B 写 0x1000 完全是两个物理位置**——这是虚拟内存 + MMU 帮你做的。

这就是为什么"杀进程"那么放心——这个进程的所有内存随它一起被回收，不会留下任何残骸去影响别人。

---

## 5. 用 `/proc` 亲眼看一眼内核怎么暴露自己

`/proc` 是个特殊的"伪文件系统"——它**不是磁盘上的目录**，是内核暴露自己状态的窗口（下一篇 "一切皆文件" 会专门讲）。

打开终端跟着敲：

```bash
# 1. 看你的 shell 进程在内核里长什么样
$ echo $$
12345        # 这是你 shell 的 pid

$ ls /proc/$$/
attr  cgroup  cmdline  comm  cwd  environ  exe  fd  maps  mem  net  ns  oom_score
root  stack  stat  statm  status  syscall  ...

# 2. 看进程当前在哪个 syscall 里卡着
$ cat /proc/$$/syscall
0xea 0x... 0x... 0x... ...         # rax=0xea (futex), 这个 shell 正在等键盘输入

# 3. 看系统里所有运行中的进程
$ ls /proc | grep '^[0-9]' | wc -l
217          # 现在有 217 个进程在跑

# 4. 看内核版本（kernel 自己暴露的）
$ cat /proc/version
Linux version 5.15.0-92-generic (buildd@ubuntu) (gcc-11) ...
```

每一次 `cat /proc/...`，本质上是 **内核动态生成内容塞给你**——不在磁盘，只在内存里。

这个能力让 Linux 不需要任何 GUI 管理工具就能完整观察自己。

---

## 6. 几个"原来如此"

这层心智模型一旦建立，很多事情立刻通了：

- **段错误（Segmentation fault）** = 你访问了不属于你的虚拟内存，MMU 报警 → 内核给你发 SIGSEGV
- **OOM Killer** = 内存吃光了，内核根据 oom_score 干掉某个进程腾内存（看 `/proc/<pid>/oom_score`）
- **`sudo`** = 一种合法的方式把进程的 uid 切成 0（root），切换后 syscall 检查放宽
- **Docker 容器** = 同一个内核，只是把每个容器的 user space 框在了 namespace + cgroup 里。容器之间**共用 ring 0**，所以容器逃逸是大事件
- **WSL2** = Windows 上跑了真的 Linux 内核（轻量 VM）+ Linux userspace，syscall 是原汁原味的
- **macOS 不是 Linux** = 它的 kernel 叫 XNU（Mach + BSD），但**syscall 接口和 Linux 90% 不兼容**——这就是为什么 Docker on Mac 实际是个轻量 Linux VM

---

## 7. 现在做两件事

### ① 看下你机器最近的 syscall 调用图

```bash
$ strace -c -p 1 2>&1 &     # systemd 在干啥（Linux）
$ sleep 5
$ kill %1
```

不熟悉的 syscall 名字 `man 2 <name>` 可以查（如 `man 2 epoll_wait`）。

### ② 算一下 syscall 有多便宜

```bash
# Linux：跑 1000 万次 getpid（最简单的 syscall）
$ time perl -e 'getpid() for 1..10_000_000'
real    0m1.524s
```

1.5 秒做 1000 万次 → **每次 syscall ~150 纳秒**。便宜得离谱——所以你的 ls 才能毫无延迟地跑完 175 次。

---

> **下一篇**：[一切皆文件](everything-is-a-file)——`/proc` 是文件，硬盘是文件，网络连接是文件，连键盘都是文件。这条哲学贯穿整个 Linux，不懂它你会觉得很多 API 奇怪。
