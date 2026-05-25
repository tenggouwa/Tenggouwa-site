---
slug: everything-is-a-file
title: 一切皆文件：Linux 最经典的一句口号到底说了什么
summary: Linux 系列第 3 篇。Unix/Linux 从第一天起就坚持一条哲学——"一切皆文件"。它把硬盘、键盘、网卡、声卡、进程信息、内核参数全部包装成"可以 read/write 的文件"，让你只需要学一套接口就能操纵整台机器。本篇拆开这条哲学到底意味着什么、能让你解锁哪些操作。
tags: [linux, linux-series, philosophy, fs, proc, sys]
published_at: 2026-06-16
---

> 这是 Linux 系列的第 3 篇。前两篇讲了为什么是 Linux 和它怎么组织自己。这篇讲它**世界观的核心比喻**——也是它能用如此简洁的 API 控制如此复杂硬件的真正原因。

## 0. 一句话的重量

你的 Linux 机器上有大约 **三百多种不同类型的"东西"**：硬盘、SSD、CPU 寄存器、GPU、键盘、麦克风、USB 摄像头、网卡、显示器、声卡、内核参数、进程内存、TCP 连接、管道、共享内存……

如果每种东西都设计自己的 API——你要学 300 套。

Unix 1970 年代做出了一个决定，简单到惊人：**让它们全部假装是"文件"。统一用 open / read / write / close 操作**。

这个决定的副产品是：

```bash
# 把一段音频写进音响（早期 OSS 时代）
$ cat song.wav > /dev/dsp

# 显示器闪一下
$ echo -e '\033[1;31m hello \033[0m'

# 给另一个进程"发消息"
$ echo 'cmd' > /proc/123/cmdline  # （实际现代内核不让写，但 fd 抽象一致）

# 读 CPU 温度
$ cat /sys/class/thermal/thermal_zone0/temp
52000   # 52.0 °C

# 看正在跑的所有 TCP 连接
$ cat /proc/net/tcp
```

每条命令都用同一个动词（cat / echo），操作完全不同的硬件和子系统。这就是 **一切皆文件**。

---

## 1. "文件"到底有几种

`ls -l` 第一列的字符你肯定见过：

```bash
$ ls -l /
total 76
drwxr-xr-x  2 root root  4096 Dec 15 14:22 bin
drwxr-xr-x  4 root root  4096 Dec 15 14:22 boot
drwxr-xr-x 19 root root  4060 Dec 15 14:22 dev
drwxr-xr-x 91 root root  4096 Dec 15 14:22 etc
drwxr-xr-x  3 root root  4096 Dec 15 14:22 home
lrwxrwxrwx  1 root root     7 Dec 15 14:22 lib -> usr/lib
drwxr-xr-x  2 root root  4096 Dec 15 14:22 proc
...
```

第一个字符就是文件类型，一共 7 种：

| 字符 | 类型 | 例子 |
|---|---|---|
| `-` | 普通文件（regular file） | `README.md` |
| `d` | 目录（directory） | `/etc` |
| `l` | 符号链接（symlink） | `/lib -> usr/lib` |
| `c` | 字符设备（character device） | `/dev/tty`、`/dev/random` |
| `b` | 块设备（block device） | `/dev/sda`、`/dev/nvme0n1` |
| `s` | UNIX socket | `/var/run/docker.sock` |
| `p` | 命名管道（named pipe / FIFO） | `mkfifo myfifo` 后的产物 |

**这 7 种都用同一套 syscall**（open / read / write / close / ioctl 等）操作。

---

## 2. 三类特殊文件，每一类都打开一扇门

### ① 设备文件：`/dev`

```bash
$ ls -l /dev/ | head
brw-rw---- 1 root disk     8,   0 Dec 15 14:22 sda          # 整块硬盘
brw-rw---- 1 root disk     8,   1 Dec 15 14:22 sda1         # 第一个分区
crw-rw-rw- 1 root tty      5,   0 Dec 15 14:22 tty          # 当前终端
crw-rw-rw- 1 root root     1,   3 Dec 15 14:22 null         # 黑洞
crw-rw-rw- 1 root root     1,   5 Dec 15 14:22 zero         # 无尽 0
crw-rw-rw- 1 root root     1,   8 Dec 15 14:22 random       # 随机字节
crw-rw-rw- 1 root root     1,   9 Dec 15 14:22 urandom      # 同上，不阻塞
crw-rw-rw- 1 root root    10, 200 Dec 15 14:22 net/tun      # 虚拟网卡
```

`/dev` 下每一个"文件"背后**都是一个驱动**。你 `read` 它就是在调驱动。

立刻能用的几个：

```bash
# 把任何东西丢进黑洞（/dev/null）
$ command_with_noisy_output > /dev/null 2>&1

# 生成一个 100MB 的零字节测试文件
$ dd if=/dev/zero of=test.bin bs=1M count=100

# 生成 16 字节随机十六进制（密码生成器）
$ head -c 16 /dev/urandom | xxd -p

# 直接读硬盘前 512 字节（MBR 引导扇区）
$ sudo dd if=/dev/sda bs=512 count=1 | xxd | head
```

### ② `/proc`：内核状态的实时窗口

`/proc` 不在磁盘上，是**内核动态生成**的"虚拟文件系统"（procfs）。每次 `cat`，内核当场把对应数据序列化成文本。

最常用的几个：

```bash
$ cat /proc/cpuinfo       # CPU 型号 / 核数 / cache / flags
$ cat /proc/meminfo       # 内存详细情况
$ cat /proc/version       # 内核版本
$ cat /proc/uptime        # 开机多久了（秒数）
$ cat /proc/loadavg       # 1/5/15 分钟负载

# 每个进程都是一个目录
$ ls /proc/$$/            # $$ 是当前 shell 的 pid
cmdline  cwd  environ  exe  fd  maps  mem  status  ...

$ cat /proc/$$/status | head -10
Name:   bash
Pid:    12345
PPid:   12340
Uid:    1000  1000  1000  1000
VmRSS:  4512 kB                # 这个进程占了多少物理内存

$ ls -l /proc/$$/fd/           # 这个进程打开了哪些文件
lr-x------ 1 you you 64 ... 0 -> /dev/pts/0    # stdin
lrwx------ 1 you you 64 ... 1 -> /dev/pts/0    # stdout
lrwx------ 1 you you 64 ... 2 -> /dev/pts/0    # stderr
lr-x------ 1 you you 64 ... 255 -> /home/you   # 你 cd 过的目录
```

**每个进程的 stdin/stdout/stderr 都是 fd 0/1/2，都通过 `/proc/<pid>/fd/N` 暴露**。后面"重定向"章会大量用到。

### ③ `/sys`：硬件的现代窗口

`/sys` 是 `/proc` 的现代化版本（sysfs），暴露**硬件和驱动**的状态。比 `/proc` 结构更整齐：

```bash
# 看 CPU 频率
$ cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
3800000   # 3.8 GHz

# 看电池
$ cat /sys/class/power_supply/BAT0/capacity
87

# 看键盘灯（如果有的话）
$ echo 1 | sudo tee /sys/class/leds/input*::capslock/brightness

# 看磁盘是 SSD 还是 HDD
$ cat /sys/block/sda/queue/rotational
0   # 0=SSD, 1=机械硬盘

# 看网卡链路速度
$ cat /sys/class/net/eth0/speed
1000   # Mbps
```

很多 GUI 监控工具（电池图标、CPU 频率显示）背后都只是在 cat `/sys` 下的文件。

---

## 3. 一个真实的 5 行小练习

监控当前机器的 CPU 温度 + 负载，每秒打印一次：

```bash
while true; do
  temp=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
  load=$(cut -d' ' -f1 /proc/loadavg)
  printf '[%s] temp=%s°C load=%s\n' "$(date +%T)" "$((temp/1000))" "$load"
  sleep 1
done
```

5 行 shell，零依赖，比下载一个 GUI 监控软件快 100 倍。**这就是"一切皆文件"给你的杠杆**。

---

## 4. socket / pipe 也是"文件"

不止物理硬件——抽象的通信机制也套这套接口：

```bash
# UNIX socket：进程间通信
$ ls -l /var/run/docker.sock
srw-rw---- 1 root docker 0 Dec 15 14:22 /var/run/docker.sock
# Docker CLI 跟 Docker daemon 通信，就是 read/write 这个 socket

# 命名管道：跨进程文本流
$ mkfifo /tmp/mypipe
$ cat /tmp/mypipe &              # 一个进程在另一端等
$ echo "hi" > /tmp/mypipe        # 另一边写就触发那一头读出来

# 匿名管道（shell 的 |）：内核里一段缓冲区，两个 fd 一头读一头写
$ ls | wc -l
```

每一种通信形式都长得跟普通文件一样——**`fd`（file descriptor）这个数字就是通用句柄**。无论它背后是磁盘文件、socket、管道、还是设备，对程序来说就是同一种东西。

这就是为什么 epoll / select 这类 I/O 多路复用器能"同时盯一万个 socket 和文件"——因为对它们来说**没区别**。

---

## 5. 例外：不是所有东西都精确是文件

为了诚实，得说一下：

- **网络命名空间 / cgroup**：是文件系统对象但语义复杂，不是纯 read/write
- **/dev/shm**：共享内存其实是 tmpfs 上的"文件"，但通常用 mmap 而不是 read
- **GPU 计算**：CUDA / OpenCL 用 ioctl 而不是 read/write（性能要求太高，read/write 太啰嗦）
- **现代异步 I/O（io_uring）**：fd 还在，但是不再走 read/write，走 ring buffer 队列

但这些都是为了**性能**做的特例。绝大部分操作仍然是文件接口。

---

## 6. 这条哲学的延伸：现代的"配置即文件"

"一切皆文件"还延伸出 Linux 系统配置的另一种风格——**配置即文本文件**：

```bash
/etc/passwd          # 用户列表
/etc/hosts           # DNS 短路
/etc/fstab           # 启动时挂载哪些盘
/etc/systemd/system/ # 所有自启服务
/etc/cron.d/         # 定时任务
/etc/sysctl.conf     # 内核参数
```

每一项都是**纯文本**——你能 grep、能 diff、能 git commit、能 ansible playbook、能 sed 批量改。

对比 Windows 那个 hkey_local_machine 注册表二进制黑箱，Linux 这条"文件第一"的路让运维自动化天生顺畅 10 倍。

---

## 7. 现在做一件事

打开你的终端，把下面这条命令的输出花 1 分钟读懂：

```bash
$ for n in cpuinfo meminfo uptime loadavg version; do
    echo "==== /proc/$n ===="
    head -3 /proc/$n
    echo
  done
```

你刚才用同一个动词（`head`）一口气读了 CPU、内存、运行时间、负载、内核版本——5 个看起来八竿子打不着的系统状态。

这就是这条哲学的全部魔力。

---

> **下一篇**：[Shell 是粘合剂](shell-as-glue)——`|` 这一个字符为什么是 Unix 最大的发明，以及为什么"很多小工具组合"会比"一个大工具"更强。
