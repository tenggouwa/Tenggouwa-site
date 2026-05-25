---
slug: shell-as-glue
title: Shell 不是编程语言，是一种"粘合剂"
summary: Linux 系列第 4 篇。新手最大的误会是把 shell 当成 Python 用，写完发现笨拙又难调试，然后认定"shell 难用"。其实 shell 的强项不在写算法，而在用一个字符 `|` 把一堆小工具串起来——这是 Unix 半个世纪沉淀下来最反直觉但最强大的设计。
tags: [linux, linux-series, shell, philosophy, pipe]
published_at: 2026-06-17
---

> 这是 Linux 系列的第 4 篇。前一篇讲了"一切皆文件"——这一篇讲建立在它之上的另一条同样核心的哲学：**用管道把小工具串起来**。

## 0. 一个真实的需求

假设你拿到一份网站访问日志（10 万行），你想知道：

> **"今天哪 5 个 IP 访问最多？"**

Python 写出来大概是：

```python
from collections import Counter
ips = Counter()
with open('access.log') as f:
    for line in f:
        ip = line.split()[0]
        ips[ip] += 1
for ip, n in ips.most_common(5):
    print(n, ip)
```

10 行，要 import、要写循环、要排序。

Shell 写出来：

```bash
$ awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -5
```

**一行**。而且四个工具加起来不到 200KB，跑 10 万行毫秒级。

这就是 shell 的本意——不是用来"写程序"，是用来**调动一支早就训练好的部队**。

---

## 1. Unix 哲学的 4 句话

Doug McIlroy（管道发明人）1978 年写的：

> 1. Make each program do one thing well.
>    （**让每个程序做一件事，做对**）
> 2. Expect the output of every program to become the input to another, as yet unknown, program.
>    （**预期每个程序的输出都将成为另一个未知程序的输入**）
> 3. Design and build software, even operating systems, to be tried early.
>    （**早试错，包括操作系统**）
> 4. Use tools in preference to unskilled help to lighten a programming task.
>    （**优先用工具而不是手写代码**）

第 1 条解释了为什么 Linux 里有 200 多个看起来"功能很少"的命令：`cut` 只切列、`sort` 只排序、`uniq` 只去重——每个都是单功能，但都做到极致。

第 2 条是设计灵魂——**所有工具默认从 stdin 读、向 stdout 写**，这样它们才能用管道串起来。

---

## 2. `|` 这一个字符的内涵

`|` 是管道（pipe）。它做了一件特别简单的事：

> **把左边命令的 stdout 接到右边命令的 stdin。**

机制上：

- shell 创建一个匿名管道（内核里一段 64KB 左右的环形缓冲）
- 左边进程的 fd 1（stdout）被重定向到管道的写端
- 右边进程的 fd 0（stdin）被重定向到管道的读端
- 两个进程**同时**跑，左边写、右边读，并发流式

关键点是 **"同时跑"** 和 **"流式"**——不是 A 跑完再给 B，而是边产生边消费。所以：

```bash
$ grep "ERROR" huge.log | head -10
```

不是先读完整个 huge.log 再 grep——是**只读到出现 10 个 ERROR 就停**。这种 lazy 流式行为是管道的杀手锏。

---

## 3. 一个小工具花园

学 shell 不是学 200 个命令，是认识这十几个最高频的"积木"：

### 取数据的

| 工具 | 一句话 |
|---|---|
| `cat` | 把文件吐到 stdout |
| `head -n N` | 取前 N 行 |
| `tail -n N` | 取后 N 行 |
| `tail -f` | 实时跟踪日志 |

### 选数据的

| 工具 | 一句话 |
|---|---|
| `grep <pattern>` | 按行筛选（正则） |
| `cut -f N -d X` | 按列切（分隔符 X 的第 N 列） |
| `awk '{print $N}'` | 按列切 + 简易计算 |
| `sed 's/A/B/g'` | 按行替换 |

### 整理数据的

| 工具 | 一句话 |
|---|---|
| `sort` | 排序 |
| `sort -n` | 按数字排序 |
| `sort -rn` | 倒序按数字 |
| `uniq -c` | 去重并计数（**前置 sort 是必须的**） |
| `wc -l` | 数行数 |

### 控制流的

| 工具 | 一句话 |
|---|---|
| `xargs` | 把上游 stdin 当参数喂给下游 |
| `tee` | 一份输出同时写文件和 stdout |
| `tr 'A' 'B'` | 字符替换 |

10 个左右把这些组合起来——你能解决 90% 的"我要处理这堆文本"的问题。

---

## 4. 实战 5 例：组合的威力

### 例 1：日志里访问最多的 IP

```bash
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -5
```

四个工具：取列 → 排序 → 去重计数 → 倒序排 → 取前 5。**比写循环快 5 倍**。

### 例 2：当前最吃内存的 5 个进程

```bash
ps aux --sort=-%mem | head -6
```

或纯管道版：

```bash
ps aux | sort -k4 -rn | head -6
```

### 例 3：找占空间最大的目录

```bash
du -h --max-depth=1 /var | sort -hr | head -10
```

`-h` 是人类可读单位（K/M/G），`sort -h` 知道怎么按这种单位排。

### 例 4：当前 TCP 连接的状态统计

```bash
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c
```

输出大概：

```
   6 ESTAB
  12 LISTEN
   2 TIME-WAIT
```

### 例 5：批量改一组文件名

```bash
ls *.JPG | sed 's/\.JPG$/\.jpg/' | xargs -n2 mv
# 或者更直观
for f in *.JPG; do mv "$f" "${f%.JPG}.jpg"; done
```

---

## 5. 一个反例：什么时候不该用 shell

shell 的强项是**编排**，弱项是**算法**。当出现这些信号时，立刻切 Python / Go：

- ❌ 需要嵌套数据结构（哈希里套数组）
- ❌ 需要 HTTP 客户端、JSON 解析、数据库连接（用 `jq` 应付简单 JSON 可以，复杂的就别折磨自己）
- ❌ 需要捕获多个异常分别处理
- ❌ 性能要求亚毫秒（shell 进程启动有几毫秒开销）
- ❌ 脚本超过 100 行还在长

**经验法则**：

> 如果一段 shell 脚本里出现了 `if [ ... ]; then for ...; do if ... ; done; done`，立刻 Ctrl+C，打开 Python 重写。

shell 的甜点是 5-20 行——再长就该升级。

---

## 6. 一个进阶技巧：process substitution

普通管道只能"一条流入一条出"。当你需要**同时比较两个流**时，`<(cmd)` 这个语法让你把命令的输出当作"文件"用：

```bash
# 对比两个目录的内容（不用先存到文件再 diff）
$ diff <(ls dir1) <(ls dir2)

# 对比远端文件和本地文件
$ diff <(ssh server cat /etc/nginx/nginx.conf) /etc/nginx/nginx.conf
```

`<(cmd)` 背后是个匿名命名管道——还是文件接口（呼应上一篇的"一切皆文件"）。

---

## 7. 关于 `|`、`&&`、`;` 的区别（新手最容易混）

| 运算符 | 含义 |
|---|---|
| `a \| b` | a 的**输出**喂给 b 的输入，两边**同时跑** |
| `a && b` | a **成功**了再跑 b（返回码 0 = 成功） |
| `a \|\| b` | a **失败**了才跑 b（fallback） |
| `a ; b` | a 跑完不管成不成都跑 b |
| `a & b` | a 后台跑，立刻接着跑 b |

混在一起的实战：

```bash
# 先 cd，cd 成功才 ls
$ cd /var/log && ls

# 编译，失败就发钉钉
$ make build || curl -X POST ...dingtalk-webhook...

# 跑测试 + 部署 + 记日志一气呵成
$ pytest && ./deploy.sh && date >> deploy.log
```

---

## 8. 现在做一件事

打开你机器的一份"有内容的文本文件"——可以是：

- Mac：`/var/log/system.log` 或某个项目的 git log
- Linux：`/var/log/syslog` 或 `journalctl -n 1000` 的输出

跑下面这串，分析一下出现最多的关键词：

```bash
# 这一串干了什么？
$ tail -1000 /var/log/syslog \
    | awk '{print $5}' \
    | sort \
    | uniq -c \
    | sort -rn \
    | head -10
```

读一遍每一步——`tail` 取最后 1000 行，`awk` 切第 5 列，`sort` 排序为 `uniq` 做准备，`uniq -c` 计数，再次 `sort -rn` 按计数倒序，`head -10` 取前 10。

**你读懂了，你就有 shell 思维了**。

---

> **下一篇**：[5 分钟逛遍 Linux 根目录](fhs-tour)——`/etc` / `/var` / `/usr` / `/opt` / `/proc` / `/sys` 这些目录到底各管什么，装一个新软件文件会撒到哪里。
