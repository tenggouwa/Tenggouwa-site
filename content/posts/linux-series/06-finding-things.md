---
slug: finding-things
title: 找东西的 5 件武器：find / fd / grep / rg / locate
summary: Linux 系列第 6 篇。"我记得有个文件 / 这串字符在某个项目里出现过"——日常你要花一半时间在 Linux 上做的就是"找"。这篇拆 5 件主流武器：按名找（find / fd / locate）、按内容找（grep / rg），各自什么场景最快、参数怎么记。
tags: [linux, linux-series, shell, find, grep, ripgrep]
published_at: 2026-06-19
---

> 这是 Linux 系列的第 6 篇。从这章开始我们离开"心智模型"，进入**日常 shell 工具**——你打开终端就要用的那些。这一篇是最高频的：**找东西**。

## 0. 两类需求，两套工具

"找"分两种：

| 你想找 | 工具 |
|---|---|
| **文件名 / 路径**（"那个 config.yml 在哪？"）| `find` / `fd` / `locate` |
| **文件内容**（"哪个文件含 `TODO`？"）| `grep` / `rg`（ripgrep） |

新手最常犯的错是混用——用 grep 找文件名（grep 不递归就漏，递归就慢），用 find 找内容（要套 -exec grep）。**分清两类**是入门第一步。

---

## 1. find：所有发行版都有，参数像古董

`find` 是 1970 年代的工具，所有 Linux/Mac 都自带。语法上像古董，但保证能用：

```bash
# 基本格式
$ find <起始路径> <表达式>

# 找所有 .log 文件
$ find /var/log -name '*.log'

# 当前目录递归找
$ find . -name '*.py'

# 不区分大小写
$ find . -iname 'readme*'

# 限定深度（只看 2 级以内）
$ find . -maxdepth 2 -name '*.md'

# 按类型筛
$ find . -type f -name '*.json'    # f 普通文件
$ find . -type d -name 'node_modules'  # d 目录
$ find . -type l                    # l 符号链接

# 按大小
$ find . -size +100M                # 大于 100MB
$ find . -size -1k                  # 小于 1KB

# 按修改时间
$ find . -mtime -7                  # 7 天内改过
$ find . -mtime +30                 # 30 天前改过
$ find . -mmin -60                  # 1 小时内改过

# 多条件 AND（直接连）
$ find . -type f -name '*.log' -size +100M -mtime -7

# OR 要小心括号
$ find . \( -name '*.py' -o -name '*.js' \)
```

### find 的杀手锏：`-exec`

`find` 不止能找，还能**对每个结果跑命令**：

```bash
# 删掉所有 30 天前的 .tmp 文件
$ find /tmp -name '*.tmp' -mtime +30 -delete

# 找到所有大于 100MB 的文件，列出大小排序
$ find . -type f -size +100M -exec ls -lh {} \;

# 给所有 .sh 文件加可执行权限
$ find . -name '*.sh' -exec chmod +x {} \;

# 更现代的写法（用 + 而不是 \;，把所有结果合成一次调用，快 100x）
$ find . -name '*.log' -exec gzip {} +
```

`{}` 是占位符，被替换成当前找到的路径；`\;` 是结束符（要转义防 shell 吃掉）。

### find 容易踩的坑

```bash
# ❌ 这样找不到（'*.log' 没引号，shell 会先展开）
$ find . -name *.log

# ✅ 一定加引号
$ find . -name '*.log'
```

---

## 2. fd：find 的现代版，记忆负担只剩 1/10

[fd](https://github.com/sharkdp/fd) 是 Rust 写的 `find` 替代品，**默认行为聪明 10 倍**：

- 默认就忽略 `.gitignore` 里的内容（不会扫 `node_modules`）
- 默认不区分大小写
- 默认彩色 + 友好输出
- 默认 8 线程并行

```bash
# 装一下（Mac）
$ brew install fd

# Ubuntu/Debian
$ sudo apt install fd-find    # 命令名是 fdfind，自己 alias 成 fd

# 用法直接
$ fd config              # 当前目录递归找名字含 config 的
$ fd '\.py$'             # 用正则找 .py
$ fd -e py               # 按扩展名找
$ fd -t f config         # -t f 只要文件
$ fd -t d node_modules   # -t d 只要目录
$ fd --hidden config     # 包含 .开头的隐藏文件
$ fd --no-ignore config  # 不忽略 .gitignore
$ fd -x wc -l            # 对每个结果跑命令（替代 find -exec）
```

**经验**：90% 的"找文件名"场景用 `fd`，剩下 10% 复杂条件（按大小 + 时间 + 多类型组合）才搬出 `find`。

---

## 3. locate：秒级响应的"老式索引"

`find` 和 `fd` 每次都是**现场扫**——大目录可能要几秒到几分钟。`locate` 走另一条路：

```bash
# locate 用一个预建的数据库（默认每天更新一次）
$ locate config.yml      # 毫秒级返回所有匹配路径

# Mac 上叫 mdfind（macOS Spotlight 索引）
$ mdfind -name "config.yml"
```

数据库由 `updatedb` 维护（crontab 里跑）：

```bash
# 强制刷一次索引
$ sudo updatedb
```

**优点**：闪电快。**缺点**：

- 新增文件要等下次 updatedb 才能找到（最坏 24h）
- 只索引文件名，不能按大小 / 时间筛
- Mac 上 mdfind 会被 Spotlight 索引覆盖范围限制

**最佳用法**：找你**几个月前**装到某处的库 / 文件，不知道在哪。`find` 全盘扫太慢，`locate` 一秒出。

---

## 4. grep：找内容的标配

grep 找**文件内容**：

```bash
# 基本
$ grep 'TODO' file.py

# 多文件
$ grep 'TODO' *.py

# 递归整个目录
$ grep -r 'TODO' .       # 或 grep -R

# 只显示文件名
$ grep -rl 'TODO' .

# 忽略大小写
$ grep -i 'error' app.log

# 反向（不含某字符串的行）
$ grep -v 'DEBUG' app.log

# 显示行号
$ grep -n 'def main' *.py

# 显示上下 3 行（context）
$ grep -C 3 'error' app.log
$ grep -A 3 'error' app.log     # 后 3 行
$ grep -B 3 'error' app.log     # 前 3 行

# 正则（默认 BRE，加 -E 是 ERE，加 -P 是 Perl 正则）
$ grep -E '^(GET|POST)' access.log
$ grep -P '\d{4}-\d{2}-\d{2}' app.log
```

### 排除某些目录

```bash
# 排除 node_modules（不递归进去）
$ grep -r 'TODO' . --exclude-dir=node_modules

# 排除某些文件类型
$ grep -r 'TODO' . --exclude='*.log'

# 只在某些文件类型里找
$ grep -r 'TODO' . --include='*.py'
```

但你会发现写这堆 `--exclude-dir` 很烦——这就是 `rg` 出场的时机。

---

## 5. ripgrep（rg）：grep 的下一代

[ripgrep](https://github.com/BurntSushi/ripgrep) 也是 Rust 写的，速度和 UX 都甩 grep 几条街：

```bash
# 装
$ brew install ripgrep            # Mac
$ sudo apt install ripgrep        # Ubuntu 18.10+

# 默认就递归 + 默认尊重 .gitignore + 默认不进 .git
$ rg TODO                         # 当前目录找 TODO

# 默认就有颜色 + 行号 + 文件名分组
$ rg 'def main'

# 限定文件类型
$ rg --type py 'def main'         # 只搜 .py
$ rg -t py 'def main'             # 同上
$ rg -t-py 'def main'             # 排除 .py
$ rg --type-list                  # 看支持哪些类型

# 文件名匹配 + 内容匹配组合
$ rg -g '*.py' 'TODO'             # 类似 grep --include

# 显示上下文（同 grep）
$ rg -C 3 'error'

# 只显示文件名
$ rg -l 'TODO'

# 在压缩文件里搜（rg 直接搞）
$ rg -z 'error' app.log.gz

# 大小写：默认大小写敏感，全小写时自动 ignore-case
$ rg todo            # 全小写 → 不分大小写
$ rg TODO            # 含大写 → 严格匹配
```

**ripgrep vs grep 性能**：扫 Linux kernel 源码（~7 万文件）找一个关键词：

```
grep -r:    ~6 秒
rg:         ~0.3 秒
```

20 倍差距。原因：`rg` 多线程 + SIMD + 跳 `.gitignore`。

> **强烈建议把 `rg` 设成日常**——`alias grep="rg"` 不推荐（rg 行为太不一样会让脚本翻车），但日常交互式直接 `rg` 替代 `grep -r`。

---

## 6. 组合食谱

### "找到所有大于 1MB 的 .log 文件，统计总大小"

```bash
$ find . -name '*.log' -size +1M -exec du -ch {} + | tail -1
```

### "找到含 `import requests` 的所有 .py 文件，列出文件名"

```bash
$ rg -l 'import requests' --type py
```

### "找到 `node_modules` 占了多大磁盘"

```bash
$ find . -type d -name node_modules -prune -exec du -sh {} +
```

`-prune` 让 find 找到 node_modules 后不再进入它内部递归——避免重复计算。

### "找过去 1 小时被改过的所有文件"

```bash
$ find . -mmin -60 -type f
# 或 fd 更简洁：
$ fd --changed-within 1h
```

### "在 git 历史里找某字符串第一次出现的 commit"

```bash
$ git log -S 'mysteryFunction' --oneline | tail -1
```

`git log -S` 找的是"哪个 commit 改变了这个字符串的出现次数"——比 grep 厉害得多。

---

## 7. 速查卡：什么场景用哪个

```
找文件名 + 当前项目（被 git 管的）        → fd
找文件名 + 复杂条件（大小/时间组合）      → find
找文件名 + 全盘 + 不在乎是不是当下      → locate / mdfind
找内容 + 项目里                       → rg
找内容 + 系统文件（/etc /var 等）       → grep -r 或 rg --no-ignore
git 历史里找代码改动                   → git log -S
```

---

## 8. 现在做一件事

打开一个你熟悉的代码项目，跑这几条命令，感受工具差距：

```bash
# 1. 当前目录有多少 .py 文件
$ fd -e py | wc -l

# 2. 哪些 .py 含 TODO
$ rg -l 'TODO' -t py

# 3. 文件最大的前 5 个
$ find . -type f -size +1M -exec du -h {} + 2>/dev/null | sort -hr | head -5

# 4. 7 天内被改过的文件
$ fd --changed-within 7d -t f
```

跑完，决定一个：今天起把 **`fd` + `rg`** 加进你的 PATH。一年节省你的搜索时间能有几十小时。

---

> **下一篇**：[text-pipes](text-pipes)——`awk / sed / cut / sort / uniq` 这些流水线积木，组合起来怎么 1 行解决很多看起来"得写脚本"的活。
