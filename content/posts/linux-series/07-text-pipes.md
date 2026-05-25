---
slug: text-pipes
title: 文本流水线：cut / awk / sed / sort / uniq 全家桶
summary: Linux 系列第 7 篇。日志、CSV、配置、API 输出——你处理的文本数据 95% 都是"按行 + 按列"组织的。掌握 cut / awk / sed / sort / uniq 这 5 个工具的组合，让你不用打开 Excel 也不用写脚本，一行命令解决统计、清洗、转换的活。
tags: [linux, linux-series, shell, awk, sed, sort]
published_at: 2026-06-20
---

> 这是 Linux 系列的第 7 篇。上一篇讲怎么"找到文件"，这一篇讲"找到之后怎么处理"——shell 真正的杀手锏。

## 0. 一份样本数据

为方便练手，假设你有一份 access.log（Nginx 日志格式）：

```
192.168.1.10 - - [22/Apr/2026:10:15:32 +0800] "GET /api/posts HTTP/1.1" 200 4521
192.168.1.10 - - [22/Apr/2026:10:15:33 +0800] "GET /static/logo.png HTTP/1.1" 200 12345
10.0.0.55    - - [22/Apr/2026:10:15:33 +0800] "POST /api/login HTTP/1.1" 401 89
192.168.1.10 - - [22/Apr/2026:10:15:34 +0800] "GET /api/posts/1 HTTP/1.1" 200 2341
...
```

下面所有命令都基于这种"每行一条记录，列用空格分"的数据。

---

## 1. `cut`：按列切，最简单的那个

```bash
# 按字符位置切
$ cut -c 1-7 file.txt       # 每行前 7 个字符

# 按分隔符切
$ cut -d ',' -f 2 data.csv         # 取第 2 列（逗号分隔）
$ cut -d ',' -f 1,3 data.csv       # 取第 1 和第 3 列
$ cut -d ',' -f 2- data.csv        # 从第 2 列到结尾

# 日志取 IP（默认分隔符其实是 Tab，要显式指定空格）
$ cut -d ' ' -f 1 access.log
```

**坑**：`cut -d ' '` 只把**单个空格**当分隔符。日志里两个空格连一起会切错——这种场景该上 `awk`。

---

## 2. `awk`：行 + 列 + 表达式的瑞士军刀

awk 是一门小型编程语言（M. Aho, P. Weinberger, B. Kernighan 三个名字首字母），但 99% 的日常用法只是它的皮毛：

```bash
# 取第 N 列（awk 自动按空白切，多个空格当一个）
$ awk '{print $1}' access.log

# 多列
$ awk '{print $1, $7, $9}' access.log

# 改分隔符
$ awk -F ',' '{print $2}' data.csv         # CSV
$ awk -F ':' '{print $1}' /etc/passwd      # 用户名

# 加条件（过滤）
$ awk '$9 == 401' access.log              # 只看 401 行
$ awk '$9 >= 500' access.log              # 5xx 错误
$ awk '$10 > 10000' access.log            # body 大于 10KB

# 算总和（统计第 10 列总流量）
$ awk '{sum += $10} END {print sum}' access.log

# 算平均
$ awk '{sum += $10; count++} END {print sum/count}' access.log

# 计数（多少条记录）
$ awk 'END {print NR}' access.log         # NR = 行号变量

# 唯一值（不去重也能算）
$ awk '!seen[$1]++' access.log            # 第 1 列去重输出
```

### awk 的核心：模式 + 动作

```awk
模式 { 动作 }
```

- 模式空了 → 每行都跑动作
- 动作空了 → 默认 print
- 多个模式可堆叠

```bash
# 多条规则
$ awk '
  /ERROR/ { errors++ }
  /WARN/  { warnings++ }
  END     { print "errors:", errors, "warnings:", warnings }
' app.log
```

### awk 5 个内置变量记下来就够用了

| 变量 | 含义 |
|---|---|
| `$0` | 整行 |
| `$1, $2, …` | 第 N 列 |
| `NF` | 当前行的列数（`$NF` = 最后一列） |
| `NR` | 当前是第几行 |
| `FS` | 输入分隔符（`-F` 设置） |

---

## 3. `sed`：流式编辑器，主要用来替换

sed 99% 的用途是**替换**和**删行**：

```bash
# s/A/B/ 替换（默认每行只换第一个）
$ sed 's/old/new/' file.txt

# 加 g：每行所有出现都换
$ sed 's/old/new/g' file.txt

# 在原文件改（-i = in place）
$ sed -i 's/old/new/g' file.txt

# Mac 上 -i 要给个空字符串作备份后缀
$ sed -i '' 's/old/new/g' file.txt

# 按行号删
$ sed '5d' file.txt          # 删第 5 行
$ sed '1,10d' file.txt       # 删 1-10 行
$ sed '/^#/d' file.conf      # 删所有以 # 开头的行（去注释）

# 按行号打印
$ sed -n '5,15p' file.txt    # 只打印 5-15 行
$ sed -n '/ERROR/p' app.log  # 只打印含 ERROR 的（等于 grep）

# 多条规则
$ sed -e 's/foo/bar/g' -e 's/baz/qux/g' file.txt

# 替换里用捕获组
$ echo 'name=John' | sed 's/name=\(.*\)/hello \1/'
hello John

# 现代版（-E 用扩展正则，括号不用转义）
$ echo 'name=John' | sed -E 's/name=(.*)/hello \1/'
```

### 一个真实例子：把 nginx 日志里的 IP 全部替换成 `X.X.X.X` 脱敏

```bash
$ sed -E 's/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/X.X.X.X/' access.log
```

---

## 4. `sort` + `uniq`：排序 + 去重 + 计数

这俩**总是配合用**——`uniq` 只会折叠相邻的重复行，所以前面一定要 `sort` 让相同的挨在一起：

```bash
# 基本去重
$ sort file.txt | uniq

# 计数（出现次数）
$ sort file.txt | uniq -c

# 只显示重复的
$ sort file.txt | uniq -d

# 只显示出现一次的
$ sort file.txt | uniq -u

# 按数字排序
$ sort -n file.txt          # 升序
$ sort -rn file.txt         # 降序

# 按某列排序
$ sort -k 3 -n file.txt     # 按第 3 列数字排
$ sort -k 3,3 -n            # 只按第 3 列（默认 k3 是"从第 3 列到结尾"，区别明显）

# 按"人类大小"排序（K/M/G）
$ du -h /var/* | sort -hr

# 大文件排序（自动用磁盘做归并）
$ sort -S 1G big.log        # 给 1G 内存
```

---

## 5. 组合食谱：5 个 1 行小程序

### ① 访问最多的 5 个 IP

```bash
$ awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -5
```

### ② 各 HTTP 状态码分布

```bash
$ awk '{print $9}' access.log | sort | uniq -c | sort -rn
   12055 200
    1340 404
     234 500
      89 401
```

### ③ 每小时请求量

```bash
$ awk '{print substr($4, 14, 2)}' access.log | sort | uniq -c
   132 09
   589 10
   912 11
  1024 12
```

`substr($4, 14, 2)` 从 `[22/Apr/2026:10:15:32` 的第 14 个字符开始取 2 个 = `10`（小时）。

### ④ 哪些 URL 最慢（假设第 11 列是响应时长 ms）

```bash
$ awk '{print $11, $7}' access.log | sort -rn | head -10
```

### ⑤ 统计每个用户的登录失败次数

```bash
$ grep 'Failed password' /var/log/auth.log \
    | awk '{print $9}' \
    | sort | uniq -c | sort -rn
```

---

## 6. `tr`：字符级转换（轻量补充）

```bash
# 大小写转换
$ echo 'HELLO' | tr 'A-Z' 'a-z'        # hello

# 删字符
$ echo 'hello world' | tr -d ' '       # helloworld

# 压缩重复字符
$ echo 'aaabbb' | tr -s 'a'            # abbb (a 被压成一个)

# 换行符转空格（让多行变一行）
$ cat file | tr '\n' ' '
```

---

## 7. `column`：列对齐排版（输出更美）

最后处理完一堆数据，肉眼看会很挤。`column -t` 自动对齐：

```bash
$ ps aux | head -5 | column -t | head -5
USER  PID  %CPU  %MEM  VSZ      RSS    TTY    STAT  START  TIME  COMMAND
root  1    0.0   0.4   168568   12808  ?      Ss    Apr20  0:21  /sbin/init
root  2    0.0   0.0   0        0      ?      S     Apr20  0:00  [kthreadd]
...
```

肉眼立刻顺眼很多。

---

## 8. 一个综合实战：从访问日志生成 5 分钟概况

```bash
#!/bin/bash
LOG=/var/log/nginx/access.log

echo "=== 总请求数 ==="
wc -l < "$LOG"

echo
echo "=== Top 5 IP ==="
awk '{print $1}' "$LOG" | sort | uniq -c | sort -rn | head -5

echo
echo "=== 状态码分布 ==="
awk '{print $9}' "$LOG" | sort | uniq -c | sort -rn

echo
echo "=== Top 10 URL ==="
awk '{print $7}' "$LOG" | sort | uniq -c | sort -rn | head -10

echo
echo "=== 总流量 ==="
awk '{sum += $10} END {printf "%.2f MB\n", sum/1024/1024}' "$LOG"
```

25 行。换成 Python 至少 50 行还要 import。

---

## 9. 现在做一件事

在你自己的机器上拿一份真实文本（任意一个 log、CSV、`history` 输出），跑这 4 条：

```bash
# 1. 总行数
$ wc -l file

# 2. 最长的 5 行
$ awk '{print length, $0}' file | sort -rn | head -5

# 3. 出现最多的第一列
$ awk '{print $1}' file | sort | uniq -c | sort -rn | head

# 4. 改写后保存
$ sed 's/old/new/g' file > file.new
```

熟悉了节奏就可以告别 Excel + Python 的"杀鸡用牛刀"了。

---

> **下一篇**：[redirection](redirection)——`> >> 2>&1 < <<<` 这一堆符号到底什么意思，怎么 1 行里把 stdout / stderr / 文件 三方喂给不同地方。
