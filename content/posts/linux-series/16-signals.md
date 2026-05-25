---
slug: signals
title: 信号机制：Ctrl+C 按下去机器内部发生了什么
summary: Linux 系列第 16 篇。信号（signal）是 Unix 进程间最古老的通信手段——内核能在不打扰进程"主线程"的情况下捅它一下，让它去做点别的。这一篇拆 SIGTERM / SIGKILL / SIGHUP / SIGCHLD 这些常见信号的用途、进程怎么 catch、为什么 SIGKILL 不能拦截、信号编号和发行版的关系。
tags: [linux, linux-series, signal, ipc, kernel]
published_at: 2026-06-29
---

> 这是 Linux 系列的第 16 篇。上一篇讲了进程"怎么来"——这一篇讲怎么从外面**戳它**。

## 0. 一个你每天按 1000 次的快捷键

```bash
$ sleep 100
^C
$
```

按下 Ctrl+C 这一刻：

1. 终端驱动捕获到这个键
2. 它把 **SIGINT 信号**发给前台进程组
3. sleep 进程没特别处理 SIGINT → 内核执行默认动作 → **进程终止**
4. shell 看到子进程退出，wait 收尸，打出 prompt

这一连串"按一下键就杀进程"的本事，靠的就是**信号机制**。

---

## 1. 信号到底是什么

信号是 Unix 给进程的"**异步通知**"——内核或别的进程能在你不"主动检查"的情况下塞个消息给你：

```
普通流程：进程 → syscall → 等内核返回结果（同步）
信号：    内核 / 其他进程 ─戳─→ 进程（异步，随时打断你）
```

信号本质上是一个**小整数**（1-31 为标准信号，34-64 为实时信号），内核维护一张"待处理信号"位图给每个进程。

```bash
$ kill -l
 1) SIGHUP    2) SIGINT    3) SIGQUIT    4) SIGILL    5) SIGTRAP
 6) SIGABRT   7) SIGBUS    8) SIGFPE     9) SIGKILL  10) SIGUSR1
11) SIGSEGV  12) SIGUSR2  13) SIGPIPE   14) SIGALRM  15) SIGTERM
16) SIGSTKFLT 17) SIGCHLD 18) SIGCONT   19) SIGSTOP  20) SIGTSTP
21) SIGTTIN  22) SIGTTOU  23) SIGURG    24) SIGXCPU  25) SIGXFSZ
26) SIGVTALRM 27) SIGPROF 28) SIGWINCH  29) SIGIO    30) SIGPWR
31) SIGSYS
34-64) SIGRTMIN .. SIGRTMAX  (实时信号)
```

**值得背的 10 个**（剩下用到时再查）：

| 编号 | 名字 | 默认行为 | 用途 |
|---|---|---|---|
| 1 | **SIGHUP** | 终止 | 终端关掉、或"请重载配置"（习俗） |
| 2 | **SIGINT** | 终止 | Ctrl+C |
| 3 | SIGQUIT | 终止 + core dump | Ctrl+\，让你拿 core 调试 |
| 9 | **SIGKILL** | 终止 | **不可拦截**，硬杀 |
| 11 | SIGSEGV | 终止 + core | 段错误（访问非法内存） |
| 13 | SIGPIPE | 终止 | 写到已关闭的管道（`yes | head` 那一刻） |
| 14 | SIGALRM | 终止 | 定时器到时 |
| 15 | **SIGTERM** | 终止 | **优雅退出**（kill 默认） |
| 17 | **SIGCHLD** | 忽略 | 子进程死了，提醒父 |
| 18/19 | SIGCONT/SIGSTOP | 继续/暂停 | Ctrl+Z（实际发 SIGTSTP=20） |

> **注意编号在不同架构上不完全一致**——SIGUSR1 / SIGUSR2 在 x86 是 10 / 12，在 MIPS / Alpha 是 16 / 17。**用名字，不要硬编码数字**。`kill -USR1 <pid>` 比 `kill -10 <pid>` 可移植。

---

## 2. 默认动作：进程没 catch 时内核怎么办

每个信号有 5 种默认处理：

| 行为 | 含义 |
|---|---|
| **Term** | 终止进程（最常见） |
| **Core** | 终止 + 生成 core dump |
| **Ign** | 忽略（如 SIGCHLD） |
| **Stop** | 暂停进程（SIGSTOP / SIGTSTP） |
| **Cont** | 继续被暂停的（SIGCONT） |

举几个例子：

- SIGTERM 默认 Term → 进程死
- SIGCHLD 默认 Ign → 你 fork 出子进程后，子退出时父收到 SIGCHLD 但内核默认让父忽略（要 catch + wait 才能 reap）
- SIGSEGV 默认 Core → 段错误时生成 core 文件（看下面）

要看每个信号的默认动作：

```bash
$ man 7 signal | grep -A 100 'Standard signals'
```

---

## 3. 进程怎么"接信号"

每个进程对每个信号可以选 3 种处理：

1. **默认**（内核处理，多半就是死）
2. **忽略**（SIG_IGN）
3. **自定义 handler**（自己写函数处理）

### C 里写个 handler 演示

```c
#include <signal.h>
#include <stdio.h>

void my_handler(int sig) {
    printf("Caught signal %d\n", sig);
}

int main() {
    signal(SIGINT, my_handler);     // 注册 SIGINT 的 handler
    while (1) pause();              // 等信号
}
```

跑起来 Ctrl+C 不退出——只打印 `Caught signal 2` 然后继续。再 Ctrl+\（SIGQUIT）就走默认 → 终止。

### Python 同样的事

```python
import signal, time

def handler(sig, frame):
    print(f"caught {sig}")

signal.signal(signal.SIGINT, handler)
signal.signal(signal.SIGTERM, handler)

while True:
    time.sleep(1)
```

跑起来 `kill -TERM <pid>` 或 Ctrl+C，进程打印 caught 但**不退出**。要退出按 Ctrl+\ 或 `kill -9`。

---

## 4. SIGKILL 和 SIGSTOP 为什么"无法 catch"

```
所有信号都可以被进程 catch / 忽略 —— 
**除了 SIGKILL (9) 和 SIGSTOP (19)**
```

设计上故意的：**总要给系统留一个万能"硬杀"的手段**。否则任何进程都可以"拒绝被杀"。

- `kill -9 <pid>` → 进程**没机会**做清理，立刻被内核回收
- `kill -19 <pid>` → 进程立刻被冻住，连 handler 都跑不到

> **结论**：日常**先 SIGTERM 后 SIGKILL**。SIGKILL 是核选项，能不用就不用——它绕开了 close() / flush() / 删除临时文件等清理逻辑，可能损坏数据。

---

## 5. SIGHUP 的双重身份

SIGHUP 历史上叫 "hang up"——**终端挂断**：

```
你 SSH 进 server，跑了个程序
你的网断了 → ssh 进程死 → 它的子 shell 死 → shell 给所有子进程发 SIGHUP
                                              ↓
                                              你跑的程序也死
```

[09 篇](process-control)讲的 `nohup` 就是改进程的 SIGHUP handler 为 SIG_IGN——网断了它也活着。

**但现代用法**：**SIGHUP = "请重载配置"**。约定俗成的：

```bash
# nginx 重载配置（不重启）
$ sudo nginx -s reload         # 内部就是 kill -HUP <master_pid>

# rsyslog / sshd / haproxy / postfix 一系列都是 SIGHUP 触发重载
$ sudo kill -HUP $(pidof nginx)
```

为啥？因为重载配置时 SIGHUP **不会停服务**——只触发 handler 重读配置文件、graceful 滚动 worker。

---

## 6. SIGCHLD：子进程死了的通知

`SIGCHLD` 是父进程收到的"你儿子死了"信号。**默认忽略**——这就是为什么不 wait() 会产生 zombie（上一篇讲过）。

正确做法是 catch SIGCHLD 然后 wait：

```c
void sigchld_handler(int sig) {
    while (waitpid(-1, NULL, WNOHANG) > 0) ;   // 把所有死了的子全 reap
}
signal(SIGCHLD, sigchld_handler);
```

bash / nginx / docker daemon 都这么做。你看不到 zombie 在你的 shell 下出现，靠的就是 shell 在 catch SIGCHLD。

---

## 7. SIGUSR1 / SIGUSR2：留给应用自定义

`SIGUSR1` 和 `SIGUSR2` 是内核**不规定语义**的——给应用自由用。

常见用法（看 man 手册或源码）：

- **nginx**：`SIGUSR1` 重新打开日志文件（配 logrotate）；`SIGUSR2` 平滑升级二进制
- **HAProxy**：`SIGUSR1` 优雅退出
- **Postgres**：`SIGUSR1` 触发 walwriter wake
- **JVM**：`SIGUSR1` 让 jstack 自己生成线程 dump

这就是为什么 logrotate 配置经常带：

```
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    postrotate
        kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

旋转文件后**给 nginx 发 SIGUSR1**——nginx 重新 open 日志文件（新的）。日志切割不丢一条日志，nginx 也不用重启。

---

## 8. SIGPIPE：管道断了那一刻

```bash
$ yes | head -3
y
y
y
```

`yes` 一直输出，`head` 拿够 3 行就 close 自己的 stdin（管道读端）。下一次 `yes` 写管道时——

> **内核给 `yes` 发 SIGPIPE → `yes` 默认终止**

如果 `yes` 忽略了 SIGPIPE，它会一直 write 一直 EPIPE 错误。**Python 默认不忽略**，所以 Python 脚本配管道时遇到管道关闭也会优雅退出。

> **写网络服务时常忘**：socket 关了你继续 write 会触发 SIGPIPE。常见模板：
> ```c
> signal(SIGPIPE, SIG_IGN);  // 忽略 SIGPIPE，让 write 返回 EPIPE 错误码
> ```

---

## 9. 实操：发信号的三种方式

### A. `kill` 命令（最常用）

```bash
$ kill <pid>                # 默认 SIGTERM
$ kill -TERM <pid>          # 显式
$ kill -KILL <pid>          # = kill -9
$ kill -HUP <pid>           # nginx reload 常用
$ kill -USR1 <pid>          # 触发 nginx 重开日志

# 名字 / 编号都行
$ kill -15 <pid>            # = -TERM
$ kill -SIGTERM <pid>       # 也对

# 一次给多个 pid
$ kill -TERM 1234 5678 9012
```

### B. 键盘快捷键

| 键 | 信号 |
|---|---|
| Ctrl+C | SIGINT |
| Ctrl+\ | SIGQUIT（生成 core） |
| Ctrl+Z | SIGTSTP（暂停） |

这些键由**终端驱动**翻译，发给前台进程组。

### C. 进程互发：`pkill` / `killall`

```bash
$ pkill -USR1 nginx                # 给所有 nginx 进程发 SIGUSR1
$ pkill -TERM -f 'python app.py'   # 按完整 cmd 匹配
$ killall -HUP rsyslogd
```

---

## 10. core dump：从崩溃现场捞证据

`SIGSEGV` / `SIGABRT` / `SIGFPE` 这类"严重错误"信号默认动作是 **Term + Core** —— 生成 core dump 文件。core 是进程崩溃时的内存快照，可以用 gdb / lldb 离线分析。

但很多系统默认 core size 限制为 0：

```bash
$ ulimit -c
0          # 没 core
```

打开：

```bash
$ ulimit -c unlimited
$ echo '/tmp/core.%e.%p' | sudo tee /proc/sys/kernel/core_pattern

# 制造一个 crash
$ python3 -c 'import ctypes; ctypes.string_at(0)'   # SIGSEGV

# 看 core
$ ls /tmp/core.*
$ gdb /usr/bin/python3 /tmp/core.python3.12345
(gdb) bt          # backtrace 看崩在哪
```

> 注意现代 systemd 系统是 `core_pattern = |/lib/systemd/systemd-coredump`——core 被 systemd 接管：`coredumpctl list / coredumpctl gdb <pid>`。

---

## 11. 实际故事 1：Docker 容器为啥不响应 Ctrl+C

```bash
$ docker run -it python:3.12 python -c 'while True: pass'
^C    # 没反应
```

原因：

- `docker run` 时 `-it` 会启 PTY，但**容器里的 python 是 PID 1**
- PID 1 对**没显式 catch 的信号默认忽略**（内核为了保护 init）
- 所以 SIGINT 发到 python 上被忽略

解法：

```bash
# 显式 --init，让 docker 加一个 tini 当 PID 1
$ docker run --init -it python:3.12 python -c 'while True: pass'
^C   # 好了
```

或者 Python 里手动 `signal.signal(SIGINT, default_int_handler)` 显式注册。

---

## 12. 实际故事 2：systemd 怎么"优雅停服务"

```bash
$ systemctl stop nginx
```

systemd 内部：

1. 发 SIGTERM 给 nginx 主进程
2. 等待 `TimeoutStopSec=`（默认 90 秒）
3. 时间到还没死 → 发 SIGKILL 硬杀

你写 service unit 文件可以调：

```ini
[Service]
KillSignal=SIGTERM            # 第一信号
SendSIGKILL=yes               # 超时后是否硬杀
TimeoutStopSec=30             # 等多久
```

这就是为什么 `systemctl stop` 偶尔会卡 30-90 秒——它在给进程留时间做清理。

---

## 13. 现在做一件事

```bash
# 1. 看你 shell 当前对各信号的处理
$ cat /proc/$$/status | grep ^Sig
SigQ:   0/15490
SigPnd: 0000000000000000
SigBlk: 0000000000010000      # bash 屏蔽的（一般是 SIGCHLD 给内部处理）
SigIgn: 0000000000384004      # 忽略的
SigCgt: 000000004b817efb      # catch 的

# 2. 信号位图怎么读：每位对应一个信号
$ python3 -c "
import sys
mask = 0x4b817efb
for i in range(64):
    if mask & (1 << i):
        print(f'  caught signal {i+1}')
" | head -10

# 3. 自己写 trap：bash 也能 catch 信号
$ trap 'echo got SIGINT' INT
$ kill -INT $$
got SIGINT
$ trap - INT     # 取消

# 4. 看哪些进程在 ignore SIGINT
$ for pid in $(pgrep -u $USER); do
    if grep -q '^SigIgn.*[fF].*$' /proc/$pid/status 2>/dev/null; then
      cat /proc/$pid/comm
    fi
  done | head
```

理解信号——你看 systemd 文档、写优雅退出代码、调 docker / 内核日志都顺手。

---

> **下一篇**：[systemd-services](systemd-services)——`systemctl / journalctl / .service` 文件全攻略，把"开机自启"从玄学变成 5 分钟搞定。
