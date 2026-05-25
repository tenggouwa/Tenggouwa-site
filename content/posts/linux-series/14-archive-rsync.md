---
slug: archive-rsync
title: 打包、压缩、同步：tar / gzip / zstd / rsync 实战
summary: Linux 系列第 14 篇。备份、迁移、传文件——日常运维高频动作。这一篇把 tar 的常见 4 个 flag、gzip / zstd / xz 三大压缩格式的选择、rsync 增量同步的"为什么这么快"讲清楚，并给一份"30 秒搞定 1TB 数据从 A 机到 B 机"的模板。
tags: [linux, linux-series, tar, gzip, zstd, rsync, backup]
published_at: 2026-06-27
---

> 这是 Linux 系列的第 14 篇——**文件与权限章**的收尾。前面学了找文件、看权限、管挂载——这一篇学搬运它们。

## 0. 为什么 rsync 一年节省你一年时间

举个真实例子：你笔记本上有 1TB 的项目目录，需要传到一台远程服务器：

| 方式 | 时间 | 评价 |
|---|---|---|
| `scp -r` | 几小时（看带宽） | 简单，但**每次都从零开始** |
| `tar | ssh server "tar -x"` | 同 scp，无压缩稍快 | 不支持中断续传 |
| **`rsync -av --partial`** | **首次同 scp，第二次几秒** | **只传变化的部分**，断了能续 |

rsync 是 1996 年 Andrew Tridgell 写的算法——**比对两边文件后只传不同的块**。这一个工具值得专门花 1 小时学。

下面分四节：tar / 压缩格式 / rsync / 真实场景。

---

## 1. `tar`：打包瑞士军刀

`tar` 来自 **t**ape **ar**chive（磁带归档）的缩写——历史上是给磁带备份用的。今天它的本职工作是：

> **把一棵目录树打包成一个文件**。

常用 4 个 flag 记下来够 95% 场景：

```
c  create     建
x  extract    解
t  list       列内容（不解压）
v  verbose    显示过程
f  file       后面接文件名（必加，否则 tar 默认对 stdin/stdout）
```

再加 3 个表示压缩的：

```
z  gzip       .tar.gz
j  bzip2      .tar.bz2
J  xz         .tar.xz
```

组合 4 件套：

```bash
# 打包 + gzip 压缩
$ tar czvf project.tar.gz project/

# 解压
$ tar xzvf project.tar.gz

# 只看里面有什么（不解压）
$ tar tzvf project.tar.gz

# 不压缩纯打包（速度最快）
$ tar cvf project.tar project/
```

记忆：**c**reate / e**x**tract / lis**t** + **z**ip / **f**ile。读起来 `czvf` 就是 "create-zip-verbose-file"。

### 现代 tar 自动识别压缩格式

```bash
# 不用记 z / j / J
$ tar xvf anything.tar.gz       # 自动 gunzip
$ tar xvf anything.tar.bz2      # 自动 bunzip2
$ tar xvf anything.tar.xz       # 自动 unxz
$ tar xvf anything.tar.zst      # 自动 unzstd（zstd 用 --zstd）
```

GNU tar 1.31+ 都支持自动识别。**记一条 `tar xvf`** 解 99% 的归档。

### 高频选项

```bash
# 解到指定目录
$ tar xvf foo.tar.gz -C /tmp/

# 只解某些文件
$ tar xvf foo.tar.gz --wildcards 'src/*.py'

# 打包时排除某些
$ tar czvf src.tar.gz --exclude='node_modules' --exclude='.git' src/

# 备份时保留权限 / 属主（重要！）
$ sudo tar czvf etc-backup.tar.gz --preserve-permissions /etc/

# 跟 ssh 配合："直接传到远端不落地"
$ tar cf - data/ | ssh server "tar xf - -C /backup"
```

最后这条特别有用——本机不留中间文件，直接流式传。

---

## 2. 压缩格式怎么挑

| 格式 | 速度 | 压缩比 | CPU 占用 | 适合 |
|---|---|---|---|---|
| **gzip** (.gz) | 中 | 中 | 中 | 最通用，兼容性最好 |
| bzip2 (.bz2) | 慢 | 高 | 高 | 不推荐（被 xz/zstd 全面碾压） |
| xz (.xz) | **很慢** | **最高** | 最高 | 发布软件包（一次压缩多次下载） |
| **zstd** (.zst) | **最快** | 接近 xz | 中 | **强烈推荐**，2017+ 后所有新场景 |
| zip | 中 | 中 | 中 | 跟 Windows 互通 |

### 实测对比（压缩 1GB 文本日志）

| 命令 | 时间 | 输出大小 |
|---|---|---|
| `gzip` | 8s | 220MB |
| `gzip -9` | 30s | 200MB |
| `bzip2` | 60s | 180MB |
| `xz -9` | 5min | **140MB** |
| **`zstd -3`** (默认) | **3s** | 230MB |
| `zstd -19` | 2min | 150MB |
| `zstd -19 --long` | 4min | 140MB ← **媲美 xz 但解压快 5x** |

**经验**：

- 临时压一下 / 日志压缩：`zstd`
- 一次性发布要小：`xz` 或 `zstd --long -19`
- 给老系统 / 通用：`gzip`

### 单独命令用法

```bash
# 压缩（原文件被替换成 .gz）
$ gzip large.log              # → large.log.gz
$ gzip -k large.log           # -k 保留原文件
$ gunzip large.log.gz

# 流式压缩（不替换原文件）
$ gzip < large.log > large.log.gz
$ zcat large.log.gz | grep ERROR    # 不解压直接读

# zstd
$ zstd -3 file
$ zstd -19 --long file        # 高压缩比
$ unzstd file.zst
$ zstdcat file.zst | grep ...

# 看压缩比
$ ls -lh large.log{,.gz}
```

`zcat` 系列工具（zcat / bzcat / xzcat / zstdcat）让你**不解压直接读** —— 跑 grep / awk 都行：

```bash
$ zcat app.log.gz | awk '$9 == 500' | head
```

---

## 3. `rsync`：增量同步的杀手锏

rsync 解决一个核心问题：

> **A 目录有 100GB 数据，B 目录有 99.9GB 几乎一样的数据。我怎么把 A 同步到 B，只传那 100MB 差异？**

答案：rsync 对每个文件分块算 hash，**只传 hash 不一样的块**。

### 基本用法

```bash
# 本地同步
$ rsync -av source/ destination/

# 远程同步（最常用）
$ rsync -av source/ user@server:/path/to/dest/

# 反向：从远端拉
$ rsync -av user@server:/path/ ./local/
```

注意路径末尾的 `/`：

- `rsync src/ dst/` → 把 src 内容放到 dst 下
- `rsync src dst/` → 把 src 这个目录放到 dst 下（多套一层）

**90% 的人都被这个坑过**。习惯：**两边都带 `/`** 表示"目录内容"。

### `-av` 这个组合

```
a (archive) = -rlptgoD：
   r  递归
   l  保留 symlink
   p  保留权限
   t  保留时间戳
   g  保留属组
   o  保留属主
   D  保留设备 / 特殊文件

v (verbose) = 显示传输过程
```

记 `-av` = "完整保真复制 + 看到进度"。

### 常用补充选项

```bash
-z              # 传输时压缩（带宽紧时用，CPU 多的时候用）
-h              # 人类可读大小
--progress      # 显示每个文件进度
-P              # = --partial --progress（推荐）
--delete        # 让目标跟源一模一样（**会删多余文件**，小心）
-n / --dry-run  # 干跑，看会传什么但不真的传
--exclude='*.log'   # 排除模式
--exclude-from=file # 从文件读排除规则（每行一条）
--bwlimit=10M   # 限速 10MB/s（避免占满带宽）
```

### 经典用法 5 例

```bash
# ① 推代码到生产服务器（不要 .git 不要 node_modules）
$ rsync -avP --delete \
    --exclude '.git/' --exclude 'node_modules/' \
    ./ user@prod:/var/www/myapp/

# ② 每天备份家目录到远程，带断点续传
$ rsync -avP --link-dest=/backups/yesterday \
    ~/ backup@nas:/backups/today/
# --link-dest 让没变的文件做硬链接（多次备份只占一份空间）

# ③ 镜像本地一份网站到 USB 移动盘
$ rsync -avh --delete /var/www/ /mnt/usb/web-backup/

# ④ 把 root 备份还原到新机器（保权限）
$ ssh new-server "rsync -avh root@old-server:/etc/ /etc/"

# ⑤ 验证两边一致（不实际传）
$ rsync -avhn source/ dest/ | grep -v '^total'
# 输出不为空 = 还有差异
```

### `--delete` 的危险性

```bash
# 这会让 dest 跟 src 一模一样——dest 比 src 多的文件**都被删**
$ rsync -av --delete src/ dest/

# 写错斜杠 ← 很容易
$ rsync -av --delete src dest/      # ← 没加 / 表示同步整个 src 目录
# 但配 --delete 后果可能极坏
```

**`--delete` 之前先 `-n` 干跑确认**：

```bash
$ rsync -avn --delete src/ dest/
# 看输出里有没有意外被删的，确认 OK 再去掉 -n
```

---

## 4. 实战场景

### 场景 A：1TB 数据从笔记本到 server，首次

```bash
# 笔记本上
$ rsync -avP --bwlimit=10M \
    ~/projects/big-data/ \
    user@server:/mnt/data/
```

`-P` 关键——断网了重跑同一条命令会从断点续。

### 场景 B：服务器 A 数据库每天备份到 B

```bash
# A 上（crontab）
0 2 * * * /usr/bin/rsync -avh --delete \
    /var/backups/mysql/ \
    backup@B:/backups/A/mysql/
```

每天凌晨 2 点跑，第二次开始只传当天变化。

### 场景 C：远程下载一个网站做镜像（**只读**）

```bash
# wget 也行，但 rsync 更聪明（如果对方支持 rsync daemon）
$ rsync -avh --progress rsync://mirror.kernel.org/linux/kernel/v6.x/ ./linux-mirrors/
```

很多镜像站（Linux kernel / Debian / Arch）都开了 rsync 接口，比 HTTP 快几倍。

### 场景 D：临时打包 + ssh 传输

不能持续 rsync 的场景（比如对方 rsync 没装），临时用 tar + ssh：

```bash
# 本地打包，stdin 给 ssh，远端 tar 解包，零中间文件
$ tar czf - src/ | ssh server "cd /target && tar xzf -"

# 加进度条
$ tar czf - src/ | pv | ssh server "cd /target && tar xzf -"

# 加压缩级别（zstd）
$ tar cf - src/ | zstd -3 | ssh server "cd /target && zstd -d | tar xf -"
```

### 场景 E：增量备份 + 历史快照

```bash
$ rsync -avh --delete \
    --link-dest=/backups/$(date -d 'yesterday' +%F) \
    /home/ \
    /backups/$(date +%F)/
```

每天跑：

- 没变化的文件**硬链接**到昨天的备份（**几乎不占空间**）
- 变化的文件复制新版
- 100 天后你有 100 份"完整快照"，但实际只占略大于 1 份的空间

这是 Time Machine / borgbackup 的核心原理。

---

## 5. 几个相关工具简介

| 工具 | 一句话 |
|---|---|
| **scp** | 简单远程复制；新版 ssh-9 把它**改成调 sftp**，旧脚本可能有兼容问题。日常优先用 rsync |
| **sftp** | 交互式远程文件操作（put / get / ls） |
| **rclone** | rsync 风格但**面向云存储**（S3 / GCS / OSS / OneDrive 一锅端） |
| **borgbackup** | 加密 + 去重 + 压缩 的备份神器，给 NAS 用 |
| **restic** | 同 borg 但更现代，go 写的，跨平台 |
| **lftp** | 给老 FTP / 不稳定网络用 |

云存储相关：

```bash
# rclone 例子：把本地目录传到阿里云 OSS
$ rclone config            # 配 OSS 凭据
$ rclone sync ./data/ oss-mybucket:/backup/data/
```

---

## 6. 一份"备份策略最小可用模板"

```bash
#!/bin/bash
# /usr/local/bin/daily-backup.sh
set -e

SOURCE="/home /etc /var/lib/myapp"
DEST="backup-user@nas:/backups/$(hostname)"
TODAY=$(date +%F)
YESTERDAY=$(date -d 'yesterday' +%F 2>/dev/null || date -v -1d +%F)

rsync -avh --delete \
    --link-dest="$DEST/$YESTERDAY" \
    --exclude='.cache' \
    --exclude='node_modules' \
    --exclude='*.tmp' \
    $SOURCE \
    "$DEST/$TODAY/"
```

放 crontab：

```
30 3 * * * /usr/local/bin/daily-backup.sh >> /var/log/daily-backup.log 2>&1
```

凌晨 3:30 跑，30 天循环。一台 NAS 撑下来即使 100 个快照也不会爆。

---

## 7. 现在做一件事

```bash
# 1. 把你 ~/Documents（或任何小目录）打包压缩
$ tar czvf docs.tar.gz ~/Documents/
$ ls -lh docs.tar.gz

# 2. 看看压缩比
$ du -sh ~/Documents
$ ls -lh docs.tar.gz

# 3. 用 rsync 干跑模拟一次部署
$ rsync -avhn --delete ~/Documents/ /tmp/docs-test/ | head

# 4. 测一下 zstd vs gzip 速度差
$ time tar cf - ~/Documents | gzip  > /tmp/x.gz
$ time tar cf - ~/Documents | zstd  > /tmp/x.zst
$ ls -lh /tmp/x.*

# 5. 装个 rsync daemon 模式跟外面互通（高阶，可选）
$ man rsyncd.conf
```

把这些命令变成肌肉记忆——文件与权限章节就毕业了。

---

> **下一篇**：[fork-exec](fork-exec)——"进程怎么来的"。fork()/exec() 这一对古老 syscall 是 Unix 进程模型的根，理解它你才懂为什么 shell 是这么设计的、为什么 ps 树是那个样子。
