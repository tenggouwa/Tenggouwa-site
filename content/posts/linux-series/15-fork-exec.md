---
slug: fork-exec
title: 进程怎么来的：fork / exec / wait 这套古老组合
summary: Linux 系列第 15 篇。Unix 创造了一个特别"反直觉"的设计——新进程的产生分两步：先把自己复制一份（fork），再让副本变成想跑的程序（exec）。理解这一对古老 syscall，你才懂为什么 shell 是那样工作的、为什么 zombie 进程会出现、为什么容器 PID namespace 是这么设计的。
tags: [linux, linux-series, process, fork, exec, syscall]
published_at: 2026-06-28
---

> 这是 Linux 系列的第 15 篇，进入**进程与并发章节**。前面 09 篇讲了"怎么操作进程"——这一篇讲"进程怎么来的"。

## 0. 一个奇怪的设计

如果让你设计"启动一个新程序"的 API，最直觉的写法可能是：

```c
spawn("ls", argv, envp);    // 一步到位
```

但 Unix（1969 年）选了另一条路——**两步**：

```c
pid = fork();               // 第 1 步：把自己原样复制一份
if (pid == 0) {             // 子进程里
    execve("ls", argv);     // 第 2 步：副本"变身"成 ls
}
```

50 年后这条路还在用——所有 Linux 进程都是这么生出来的（包括你的 init / systemd / nginx / chrome）。

这一篇讲为什么这么设计、它给了我们什么、它的副产品有哪些。

---

## 1. `fork()`：把自己复制一份

`fork()` 是个魔幻 syscall——**它一次返回两次**：

```c
pid_t pid = fork();
//          ↑↑↑↑↑
// 父进程里 pid = 子进程的 PID
// 子进程里 pid = 0
// 出错时   pid = -1
```

物理上发生了什么：

```
fork() 前：
┌────────────────────┐
│ 父进程 PID=12345    │
│ 内存：变量、stack   │
│ 打开的文件 fd: ...   │
└────────────────────┘

fork() 后：
┌────────────────────┐   ┌────────────────────┐
│ 父进程 PID=12345    │   │ 子进程 PID=12346    │
│ 内存：变量、stack   │ ← │ 内存：完全一样       │
│ 打开的文件 fd: ...   │   │ 打开的文件 fd: 同样  │
└────────────────────┘   └────────────────────┘
```

**子进程从 fork() 后那行开始跑**——继承父进程的：

- 内存（变量、栈、堆都一份复制）
- 打开的文件 / socket
- 当前工作目录
- 环境变量
- uid / gid

不继承的：

- PID（新 PID）
- 父 PID（PPID = 父进程的 PID）
- 大部分进程间锁

### 为什么"复制内存"不慢？COW 来救场

如果 fork 一个 8GB 的进程要复制 8GB——明显废。**实际不复制**：

> **Copy-on-Write**（写时复制，COW）：父子共享内存页，**只在某一方写**那一页时，内核才真的复制那一页。

```
父进程内存            子进程内存
   ┌─────┐               ┌─────┐
   │  P  │ ─ 都指向 ───→ │  共享物理页（标记为 RO）│
   │  P  │ ─────────────→ │
   └─────┘               └─────┘

如果父写第 1 页：
   ┌─────┐               ┌─────┐
   │  P' │ ─→ 新页 P'   │  P  │ ─→ 旧页 P
   │  P  │ ─ 都指向 ─→ │  P  │ ─→ 共享页
   └─────┘               └─────┘
```

实际开销只是页表条目的复制——fork 一个 1GB 进程几毫秒搞定。

### 看你机器上的 PID 关系

```bash
$ ps -ef --forest
UID    PID  PPID CMD
root     1     0 /sbin/init
root   234     1  ├─ /lib/systemd/systemd-journald
root   456     1  ├─ /usr/sbin/sshd
root  5678   456  │  └─ sshd: alice [accepted]
alice 5680  5678  │     └─ -bash
alice 5701  5680  │        └─ vim file.py
www-data 891 1   └─ nginx: master process
www-data 892 891    └─ nginx: worker process
```

每个进程（除了 PID 1）都有爹。`init` / `systemd` 是 PID 1，是**所有进程的祖先**。

```bash
# 自己看
$ ps -o pid,ppid,comm -p $$
$ pstree -p $$
```

---

## 2. `execve()`：让自己变成另一个程序

fork 复制出来的子进程跟父进程**一模一样**。要变成"另一个程序"——`execve()`：

```c
execve("/bin/ls", argv, envp);
//   ↓ 这一行成功后，
//   ↓ 当前进程的 PID 不变
//   ↓ 但代码、数据全被 /bin/ls 覆盖
//   ↓ execve 之后的代码永远不会执行
```

机制：

1. 内核读 ELF 二进制
2. 把当前进程的代码段 / 数据段 / 栈**全部清空**
3. 加载新程序的代码 / 数据
4. 重置 stack 跳到新程序的入口
5. 已经打开的 fd / 环境变量 / PID **保留**

注意"fd 保留"——这是 shell 重定向的根本机制（下面会讲）。

---

## 3. 为什么是两步？

把 fork 和 exec 分开，**给了 shell 在中间动手脚的机会**：

```c
// shell 跑 `ls > out.txt` 时大概是这样：
pid_t pid = fork();
if (pid == 0) {
    // 子进程
    int fd = open("out.txt", O_WRONLY | O_CREAT);
    dup2(fd, 1);              // 把 stdout（fd 1）重定向到 out.txt
    close(fd);
    execve("/bin/ls", ...);   // 现在 ls 跑起来，它的 stdout 已经被改了
}
// 父进程（shell）继续走
wait(NULL);                   // 等子进程结束
```

如果是一步式 `spawn()`，你**没法**在新进程跑起来**之前**修改它的 fd / 环境 / 工作目录。

> 这就是 Unix 神来一笔——**把"新进程"和"复用执行环境"解耦**，给中间留出空隙做配置。所有重定向、管道、setuid、chroot 都是利用这个空隙。

### 管道也是这么实现的

`ls | grep foo` 的 shell 内部大致：

```c
int pipefd[2];
pipe(pipefd);                 // pipefd[0] 读端，pipefd[1] 写端

if (fork() == 0) {            // 第一个子进程：跑 ls
    dup2(pipefd[1], 1);       // ls 的 stdout 接到管道写端
    close(pipefd[0]);
    close(pipefd[1]);
    execve("/bin/ls", ...);
}

if (fork() == 0) {            // 第二个子进程：跑 grep
    dup2(pipefd[0], 0);       // grep 的 stdin 接到管道读端
    close(pipefd[0]);
    close(pipefd[1]);
    execve("/bin/grep", ["grep", "foo"]);
}

close(pipefd[0]);
close(pipefd[1]);
wait(NULL);  wait(NULL);
```

一个 `|` 字符背后是 pipe + fork × 2 + dup2 × 2 + exec × 2。

---

## 4. 用 strace 亲眼看 shell 在干什么

```bash
$ strace -f -e fork,clone,execve,wait,dup2,close,pipe2 bash -c 'ls | head'
```

`-f` 是跟随 fork 出来的子进程。输出会很长，但**你能逐句对照上面那段伪代码**——哪一步 pipe2、哪一步 clone、哪一步 dup2、哪一步 execve。

> 现代 Linux 的 fork 内部走的是 `clone()`——传一组 flag 控制要不要共享内存 / fd / namespace 等。`fork()` 其实是 `clone(0, ...)` 的特例。pthread 创建线程也是 clone（带 CLONE_VM 表示共享内存）。

---

## 5. `wait()` 和 zombie 的故事

子进程退出后，**它的状态信息（退出码、CPU 时间）还留在内核里**——直到父进程调 `wait()` 把它"收尸"。

```c
int status;
pid_t pid = wait(&status);
//   ↑
// 父进程阻塞，直到任一子进程退出
```

如果父进程**没收尸**——子进程变成 **zombie**（僵尸进程）：

```bash
$ ps aux | grep ' Z '
USER  PID  ...  STAT  COMMAND
...   8742  ...  Z     [defunct]
```

```
状态 Z = zombie
内存几乎为 0（只剩一个 task_struct）
不能 kill（已经死了）
要让它消失：父进程 wait() 或者父进程死掉（孤儿被 init 收养，自动 reap）
```

### Zombie 出现的常见场景

1. **应用 bug**：fork 子进程不 wait，子进程退出后留下尸体
2. **PID 1 不能 reap**：早期 Docker 容器里跑某个 app 当 PID 1，子进程退出后没人 wait。需要用 `tini` 之类的 init 程序

Docker 里跑 sh 之类的 init：

```bash
$ docker run --init -it myimage   # --init 让 docker 自动加一个 tini 作 PID 1
```

### 孤儿进程：父亲先死了

父进程没 wait 就先死了的话，**子进程被 init（PID 1）收养**：

```
父进程死前       父死后
父 → 子          init(1) → 子   ← init 接管，会定期 wait 收尸
```

所以孤儿不可怕，zombie 才可怕（孤儿被 init 自动 reap）。

---

## 6. 几个常见的"奇怪现象"被解释了

### A. nohup 怎么让进程脱离终端

`nohup cmd &` 实际：

```
shell:
  fork → exec(nohup) → nohup setup → exec(cmd)

nohup 做的事：
  - 忽略 SIGHUP
  - stdout/stderr 重定向到 nohup.out
  - 然后 exec 成你的 cmd
```

跟 fork/exec 分两步无关——nohup 就是中间动了下手脚再 exec。

### B. 为什么 `cd` 不能是外部程序

```bash
$ which cd
cd: shell built-in command
```

如果 `cd` 是 `/bin/cd`，shell 就要 fork + exec 它。但子进程改了 cwd，**父 shell 的 cwd 不受影响**（每个进程独立工作目录）。

`cd` 必须是 shell **内建**（builtin），直接在 shell 进程里调 chdir() 改自己。

### C. 环境变量 export 的意义

```bash
$ FOO=bar                # 只 shell 进程有 FOO
$ env | grep FOO          # 没有！env 是 fork+exec 的，没继承 FOO
$ export FOO=bar          # 让 FOO 进入"将来 fork 出去的子进程"的环境
$ env | grep FOO         # 有了
FOO=bar
```

export 的意思是"把这个变量标记为'传给子进程'"——下一次 fork 时它会出现在子进程的 envp。

### D. `exec` 命令（shell 内建）

```bash
$ exec node app.js
```

shell **不 fork**，直接 execve("node", ...) **替换自己**。原来的 shell 进程变身成 node——所以 `exec` 后那行没了。

应用场景：

- 容器 entrypoint：`exec "$@"` 让传进来的 cmd 成为 PID 1（不留个 sh 当壳）
- 脚本结尾用 exec 替换，省一个进程

---

## 7. `daemon` 化的经典 3 步

把进程变成"后台服务"（不跟终端绑定的 daemon）的经典模式：

```
1. fork()，父退出 → 子被 init 接管（脱离终端 session）
2. setsid() → 自己变成新 session leader，彻底切断 tty
3. 再 fork() 一次 → 防止意外再获得控制终端
4. chdir("/") + 关闭 stdin/stdout/stderr → 别占着 fd
```

这就是早年 Apache / Nginx 的 daemon 化代码——20 行 C。现代 systemd 出来后**不用手动 daemon 化了**：直接前台跑，让 systemd 来管。

---

## 8. 一个能跑的小实验

```bash
# 1. 看 shell 跑命令时 fork 出去的进程
$ strace -f -e fork,clone,execve bash -c 'echo hi' 2>&1 | tail -10

# 2. 手动 fork：用 python 演示
$ python3 -c '
import os
pid = os.fork()
if pid == 0:
    print(f"child PID={os.getpid()}, PPID={os.getppid()}")
else:
    print(f"parent PID={os.getpid()}, child={pid}")
    os.waitpid(pid, 0)
'

# 3. 制造一个 zombie（父进程不 wait）
$ python3 -c '
import os, time
pid = os.fork()
if pid == 0:
    exit(0)            # 子立刻退出
else:
    print(f"child {pid} should be zombie now")
    time.sleep(30)     # 父睡着不收尸
' &
$ sleep 1 && ps aux | grep ' Z '
# 应该能看到一个 [python] <defunct>

# 30 秒后父退出，init 自动收尸，zombie 消失
```

---

## 9. 几个高频"伪面试题"的真答案

**Q：fork 一次能复制 1GB 内存吗？很慢吧？**
A：不慢。COW 让初始几乎零拷贝，只在父子任一方真写某页时才复制那一页。

**Q：fork 返回两次，怎么做到的？**
A：内核里 fork 实现一次，但**让子进程从父进程相同的指令地址继续执行**。父子的 rax 寄存器各自被设置成不同的返回值。

**Q：为什么 Docker 容器里 PID 1 那么特殊？**
A：PID 1 不处理 SIGCHLD 的话，子进程退出后 zombie 不会被 reap；PID 1 死了整个容器就退出。所以容器 entrypoint 要么是个真正的 init（tini / dumb-init），要么自己处理 SIGCHLD。

**Q：thread 和 process 在 Linux 里的区别？**
A：内核眼里都是 `task_struct`。区别只是 clone 时传不同的 flag——thread 共享内存（CLONE_VM），process 不共享。

---

## 10. 现在做一件事

```bash
# 1. 看你 shell 的进程树
$ pstree -p $$

# 2. 用 strace 看 ls 启动的全过程
$ strace -fc ls > /dev/null
# 看哪些 syscall 出现得最多

# 3. 故意制造一个孤儿（不是 zombie）
$ ( sleep 30 & )       # 子 shell 跑完立刻退出，留 sleep 给 init
$ ps -o pid,ppid,comm -C sleep
# PPID 会是 1（被 init 收养）

# 4. 看你机器现在有没有 zombie
$ ps aux | awk '$8 ~ /Z/'
```

理解 fork / exec / wait——你看任何系统调用图 / Docker 文档 / shell 实现都会顺手很多。

---

> **下一篇**：[signals](signals)——`SIGINT / SIGTERM / SIGKILL / SIGHUP / SIGCHLD` 这堆信号到底怎么传，进程怎么 catch，Ctrl+C 按下去机器内部发生了什么。
