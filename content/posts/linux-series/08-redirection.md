---
slug: redirection
title: 重定向全解：>、>>、2>&1、<、<<<、|、tee
summary: Linux 系列第 8 篇。stdout、stderr、stdin 这三个 file descriptor 是 shell 的"输入输出基础设施"，但新手常被一堆符号绕晕——`> file`、`2>&1`、`&>`、`<<<` 到底各自什么含义。这一篇把它们拆开讲清楚，并给出最常碰到的 6 个组合写法。
tags: [linux, linux-series, shell, redirection, fd]
published_at: 2026-06-21
---

> 这是 Linux 系列的第 8 篇。前面讲了管道（`|`）的核心思想——这一篇把同一族家族成员（重定向 + 管道 + tee）一次性梳理清楚。

## 0. 三个 fd 是一切的基础

每个 Linux 进程启动时，**内核自动给它准备三个文件描述符（fd）**：

| fd | 名字 | 默认指向 |
|---|---|---|
| 0 | stdin（标准输入） | 键盘（终端） |
| 1 | stdout（标准输出） | 终端屏幕 |
| 2 | stderr（标准错误） | 终端屏幕 |

"标准输出"和"标准错误"听起来很玄——其实就是程序写数据的两个**抽屉**：

- **stdout**：程序"该说的话"（数据、结果）
- **stderr**：程序"出问题的话"（警告、错误）

为什么分开？因为你可能想**把结果存文件，把错误打屏幕**——分开后能各自重定向。

```
程序
  ├── stdout (1) → 默认屏幕
  └── stderr (2) → 默认屏幕
```

重定向就是**改变其中一个 fd 的去向**。

---

## 1. `>` 和 `>>`：把 stdout 写文件

```bash
# > 覆盖式写（原文件清空）
$ echo "hello" > greeting.txt

# >> 追加式写
$ echo "world" >> greeting.txt
$ cat greeting.txt
hello
world

# 等价于 1> file（fd 1 是 stdout，可省略）
$ ls > /tmp/files.txt
$ ls 1> /tmp/files.txt    # 完全一样
```

### `> /dev/null`：丢进黑洞

```bash
$ noisy_command > /dev/null      # 不想看 stdout
```

`/dev/null` 是一个特殊设备文件——**写进去的所有东西被丢弃**，读它得到 EOF。日常常用来"隐藏输出"。

---

## 2. `2>` 和 `2>>`：把 stderr 写文件

```bash
# 2> 重定向 stderr
$ ls /nonexistent 2> errors.log
$ cat errors.log
ls: cannot access '/nonexistent': No such file or directory

# 2>> 追加 stderr
$ command 2>> errors.log

# 把 stderr 丢黑洞（最常见用法）
$ noisy_command 2> /dev/null
```

---

## 3. `2>&1`：让 stderr 跟 stdout 走同一条路

新手最绕的就是这条。读法：**"把 fd 2 重定向到 fd 1 目前指向的地方"**。

```bash
# 把 stdout 和 stderr 都写进同一个文件
$ command > all.log 2>&1
```

执行顺序（重要！）：

1. `> all.log` 把 fd 1 改成指向 all.log
2. `2>&1` 把 fd 2 也改成"fd 1 当前指向的地方" = all.log

**写反了不行**：

```bash
# ❌ 错的：先把 fd 2 指到 fd 1（这时 fd 1 还是屏幕）
#         再把 fd 1 改成 all.log（fd 2 没跟着改）
$ command 2>&1 > all.log
# 结果：stdout 进 all.log，stderr 还在屏幕
```

记忆口诀：**先指定 stdout 的去向，再让 stderr 跟过去**。

### `&>` 简写（bash 4+）

```bash
# 等价于 > file 2>&1
$ command &> all.log

# 等价于 >> file 2>&1
$ command &>> all.log
```

更新的 bash / zsh 都支持。**但 POSIX 不保证**——写脚本要兼容 sh 时还是 `> file 2>&1`。

---

## 4. `<`：把文件喂给 stdin

```bash
# 把文件内容当成程序的标准输入
$ sort < unsorted.txt

# 等价于 cat 然后管道（但少一个进程）
$ cat unsorted.txt | sort
```

什么时候用？比如某些程序**只**接受 stdin 不接受文件名参数：

```bash
$ wall < /etc/motd       # 给所有登录用户广播文件内容
```

---

## 5. `<<` 和 `<<<`：从字面量喂输入

### Here-doc（`<<`）：多行字面量

```bash
$ cat <<EOF
line 1
line 2
$USER
EOF
```

输出：

```
line 1
line 2
tenggouwa
```

`EOF` 是结束标记，可以是任何字符串。**变量会被展开**。如果不想展开：

```bash
$ cat <<'EOF'
$USER will not expand
EOF
```

引号包裹起结束符 → 内部不展开。

### Here-string（`<<<`）：单行字面量

```bash
# 给 stdin 喂一个字符串
$ bc <<< "1 + 1"
2

# 等价于：
$ echo "1 + 1" | bc
```

`<<<` 比 `echo |` 少一个 fork，性能更好（虽然差距小）。

---

## 6. `|` 管道 + `tee` 三通

`|` 已经在 [shell-as-glue](shell-as-glue) 详讲过。这里说一个常见组合：

### `tee`：一份输出同时给文件和下游

```bash
$ ls | tee files.txt          # 屏幕显示 + 写文件
$ ls | tee files.txt | wc -l  # 写文件 + 继续传给下游

# 追加模式
$ command | tee -a all.log

# 配合 sudo（让 sudo 只覆盖 tee，不动 command 自己）
$ echo "127.0.0.1 example.com" | sudo tee -a /etc/hosts
```

**经典坑**：

```bash
# ❌ 这样不行：> 是 shell 解释，shell 不是 root
$ sudo echo "x" > /etc/some.conf

# ✅ 正确：用 sudo tee
$ echo "x" | sudo tee /etc/some.conf > /dev/null
```

---

## 7. 进阶：自定义 fd（3 及以上）

bash 允许你打开新 fd（3、4、…），用于复杂场景：

```bash
# 打开 fd 3 指向 log 文件
$ exec 3> debug.log

# 之后 echo 到 fd 3
$ echo "step 1 done" >&3
$ ./command  # 正常 stdout/stderr 不受影响
$ echo "step 2 done" >&3

# 关闭 fd 3
$ exec 3>&-
```

99% 的脚本用不到，但偶尔写复杂脚本要分 4-5 路输出时很有用。

---

## 8. 实战 6 例

### ① 静默运行，只看错误

```bash
$ make 2>&1 > build.log
# 出错时只显示 stderr，stdout 全进文件
```

记 trick：先 `2>&1`（stderr 指屏幕）再 `> build.log`（stdout 进文件）。两条命令**这次顺序反着写**是对的。

### ② 把 cron 任务的 stdout/stderr 都打到日志

```bash
# crontab 里
*/5 * * * * /usr/local/bin/myjob.sh >> /var/log/myjob.log 2>&1
```

没有 `2>&1` 的话 cron 把 stderr 邮件给 root，邮箱炸了。

### ③ 同时输出到屏幕和文件（构建过程必备）

```bash
$ pnpm build 2>&1 | tee build.log
```

构建挂了能看 build.log 复盘，跑的时候也能在屏幕实时跟。

### ④ 把 stdout 进文件 A、stderr 进文件 B

```bash
$ command > out.log 2> err.log
```

调试时分开看错误特别好用。

### ⑤ 把多行配置直接写进文件

```bash
$ cat > /etc/myapp.conf <<EOF
host = 0.0.0.0
port = 8080
debug = false
EOF
```

不用打开 vim 也能"写文件"。

### ⑥ 直接喂 ssh 远程跑一段 shell

```bash
$ ssh server 'bash -s' <<'EOF'
set -e
echo "hostname: $(hostname)"
df -h
free -h
EOF
```

远程跑一段脚本但不想搞文件传输——这一招很方便。

---

## 9. 一张表速查

```
> file        stdout 覆盖写文件
>> file       stdout 追加写文件
< file        文件喂给 stdin
<< TAG ... TAG   多行字面量喂给 stdin（变量会展开）
<< 'TAG' ... TAG 多行字面量但不展开变量
<<< "str"     单行字面量喂给 stdin
2> file       stderr 写文件
2>> file      stderr 追加写文件
2>&1          stderr 跟 stdout 同向
&> file       stdout + stderr 都写文件（bash 简写）
| cmd         stdout 管道给 cmd
|& cmd        stdout + stderr 都管道给 cmd（bash 简写）
| tee file    分流：一份写文件，一份继续走管道
```

---

## 10. 现在做一件事

试试下面 4 条，分别理解输出去了哪里：

```bash
# 1. stderr 进 /tmp/err，stdout 还在屏幕
$ ls /nonexistent /tmp 2> /tmp/err

# 2. stdout 和 stderr 都进 /tmp/all
$ ls /nonexistent /tmp > /tmp/all 2>&1

# 3. 屏幕 + 文件双输出
$ ls /nonexistent /tmp 2>&1 | tee /tmp/all

# 4. heredoc 给 stdin
$ python3 <<'EOF'
print("hello from python")
EOF
```

理解 fd 0/1/2 跟符号的对应关系，你之后看任何 shell 脚本都不会被这堆符号绕晕。

---

> **下一篇**：[process-control](process-control)——前台、后台、暂停、kill、nice、nohup——进程管理的全部基本动作。
