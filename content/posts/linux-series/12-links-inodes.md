---
slug: links-inodes
title: 硬链接、软链接、inode：为什么 rm 不一定释放磁盘
summary: Linux 系列第 12 篇。"文件"在 Linux 里其实是两部分——存储数据的 inode，和指向 inode 的名字。理解了这一点，你就懂为什么硬链接的"两份"实际只占一份磁盘、为什么删进程在用的大文件磁盘不释放、为什么 ext4 偶尔"明明有空间但写不了"。
tags: [linux, linux-series, filesystem, inode, symlink, hardlink]
published_at: 2026-06-25
---

> 这是 Linux 系列的第 12 篇。上一篇讲权限——这一篇拆"文件"这个抽象本身的底层结构。

## 0. 一个让所有新手抓狂的真实故事

```bash
$ df -h /
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   28G   22G  56% /

$ tail -f /var/log/app.log
（程序运行中，日志一直涨）

$ sudo rm /var/log/app.log
$ df -h /
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   28G   22G  56% /
                       ↑ 没变？！
```

文件明明删掉了，磁盘怎么没释放？！

答案在这一篇。

---

## 1. 一个文件，两部分

Linux 的核心抽象：

```
                         ┌────────────────────────┐
   名字（文件名）  ─────► │     inode (元数据 + 指针)  │ ─────► 实际数据块
   "app.log"             │     - 大小                │       (data blocks)
                         │     - 时间戳              │
                         │     - 权限                │
                         │     - 属主                │
                         │     - 链接数              │
                         │     - 指向 data blocks    │
                         └────────────────────────┘
```

- **文件名只是个标签**——存在某个目录里
- **inode 是文件本体**——所有"关于文件的事实"都在 inode
- **data blocks 是真正的内容**——硬盘上的字节

一个 inode 可以被**多个名字**指——这就是硬链接。

```bash
$ ls -i README.md
1245678 README.md
        ↑ 这就是 inode 号
```

---

## 2. 硬链接（hard link）：同一个 inode，多个名字

```bash
$ echo "hello" > original.txt
$ ln original.txt copy.txt          # 注意：没有 -s
$ ls -li
1245678 -rw-r--r--  2  me  staff  6  Apr 22 10:00  copy.txt
1245678 -rw-r--r--  2  me  staff  6  Apr 22 10:00  original.txt
   ↑                ↑
   inode 一样        链接数 2
```

观察：

- 两个名字，**同一个 inode**
- 链接数从 1 变成 2
- 大小一样（**因为是同一份数据**，不占双倍磁盘）

改一个就是改两个（因为本来就是同一份）：

```bash
$ echo "world" >> copy.txt
$ cat original.txt
hello
world
```

删一个不影响另一个：

```bash
$ rm copy.txt
$ cat original.txt
hello
world
$ ls -li original.txt
1245678 -rw-r--r-- 1 me staff 12 ... original.txt
                  ↑ 链接数回到 1
```

### 硬链接的限制

- **不能跨文件系统**（inode 是文件系统内部的编号，跨盘没意义）
- **不能链接目录**（防止形成环——`/` 的硬链接指向 `/foo`，再链 `/foo/bar` 指向 `/`，无限循环）

### 硬链接什么时候有用

实际工作里用得不多，但有几个场景：

- **去重备份**（time machine、rsync `--link-dest`）：每次"快照"对没变化的文件只建硬链接，不复制数据。100 次快照只占 1 份空间
- **多个调用名**（busybox：一个二进制 + 硬链接成 `ls / cat / grep / vi` 等几十个名字）

---

## 3. 软链接 / 符号链接（symlink）：一个新文件，指向另一个名字

```bash
$ ln -s original.txt link.txt
$ ls -li
1245678 -rw-r--r-- 1 me staff 12 ... original.txt
1245901 lrwxrwxrwx 1 me staff 12 ... link.txt -> original.txt
   ↑    ↑
   不同  l = symlink
```

观察：

- 软链接是**一个新文件**（新 inode）
- 它的内容就是**目标的路径字符串**
- 大小 = 目标路径的字符数（这里 `original.txt` 12 字节）

软链接更像 Windows 的"快捷方式"。

### 软链接的特点

```bash
# 跨文件系统、可链接目录
$ ln -s /mnt/data /home/me/data
$ ln -s ~/projects/myapp/.env  /etc/myapp/.env

# 删目标后，软链接变"悬空"
$ rm original.txt
$ ls -l link.txt
lrwxrwxrwx 1 me staff 12 ... link.txt -> original.txt   # 还在
$ cat link.txt
cat: link.txt: No such file or directory                   # 但读不出来
```

### 硬 vs 软对比

| | 硬链接 | 软链接 |
|---|---|---|
| 是新文件吗 | 否（同 inode） | 是 |
| 跨文件系统 | ❌ | ✅ |
| 链接目录 | ❌ | ✅ |
| 删目标后还能用 | ✅ 文件还在 | ❌ 变悬空 |
| 占磁盘 | 仅多一个目录 entry | 一个新 inode + 目标路径字符串 |

**90% 场景用软链接**（`ln -s`）。硬链接是底层机制，日常很少手动建。

---

## 4. 链接数和 `rm` 的真相

`rm` 这个名字也是**误导**——它实际不是"删文件"，是"**unlink**"——把一个目录 entry（名字）解开。

```
rm file
  ↓ 内核
unlink(file)
  ↓
inode.链接数 -= 1
  ↓
if 链接数 == 0:
    if 还有进程打开它:
        等所有进程关掉 fd 再回收磁盘
    else:
        立刻回收磁盘
```

**关键**：链接数减到 0 时，**还要等所有打开 fd 的进程关掉它**，才真正释放磁盘。

这就解释了开头那个故事——

```
$ tail -f /var/log/app.log    ← 这个进程持有 fd
$ sudo rm /var/log/app.log    ← unlink 成功，但 inode 还活着
$ df -h                        ← 磁盘没变，因为 inode 还在
```

### 验证 + 救场

```bash
# 找到还在用"已删除"文件的进程
$ sudo lsof | grep deleted
nginx     ...  /var/log/nginx/access.log (deleted)
java      ...  /tmp/heap.bin            (deleted)

# 救场方法 1：把进程重启（关闭 fd）
$ sudo systemctl restart nginx

# 救场方法 2：直接清空文件，进程不重启（更优雅）
# 但这要求文件还有名字。已经 rm 的就只能从 /proc/<pid>/fd/N 抢救
$ sudo lsof | grep '(deleted)'
$ sudo cp /proc/12345/fd/5 /tmp/recovered.log    # 通过 /proc 还能读到内容
$ sudo : > /proc/12345/fd/5                      # 把 fd 指向的内容清空（释放 disk）
```

最后一招（`: > /proc/<pid>/fd/N`）是**没法重启服务时的应急**——把进程持有的 fd 内容清零，磁盘当场释放。

> **教训**：日志文件不要简单 `rm` 删——要用 `logrotate`（下面后面的章节会讲），或者直接 `: > file.log`（清空，不 unlink，进程继续用）。

---

## 5. inode 也会"用完"

文件系统在格式化时**预分配固定数量的 inode**（ext4 默认每 16KB 一个）。如果你有 **大量小文件**——inode 可能比磁盘更早耗尽：

```bash
$ df -h
/dev/sda1     50G   22G   28G  44% /

$ df -i
/dev/sda1    3.2M  3.2M    0  100% /
                          ↑
                          inode 100% 满了！
```

症状："明明 28G 空闲但写不进文件"。

```bash
# 找哪个目录吃了最多 inode
$ sudo find / -xdev -printf '%h\n' 2>/dev/null | sort | uniq -c | sort -rn | head -10
1234567 /var/spool/postfix/maildrop      ← 罪魁祸首
  89012 /var/cache/apt/...
  ...
```

常见元凶：

- 没轮转的 mail queue（postfix）
- 大量 npm `node_modules`（一个 `node_modules` 轻松 10 万文件）
- 没清的 git pack 文件
- session 文件（PHP 之类）

**解法**：删掉那堆小文件，或者新装机器时给"小文件多"的系统选不同的 inode 比率（`mkfs.ext4 -i 4096`）。

---

## 6. 软链接的几个实战玩法

### ① 系统级"当前版本"指针

```bash
$ ls /opt
node-v18.0.0/
node-v20.0.0/
node-v22.0.0/
node -> node-v22.0.0/     ← symlink 指向"当前用"的版本

# 切换版本只需要重指
$ sudo ln -snf node-v20.0.0 /opt/node
```

`nvm`、`pyenv`、`update-alternatives` 全是这个原理。

### ② 配置集中管理 + symlink 散到家

```bash
# 你的 dotfiles 都在 ~/dotfiles
$ ln -s ~/dotfiles/.zshrc       ~/.zshrc
$ ln -s ~/dotfiles/.gitconfig   ~/.gitconfig
$ ln -s ~/dotfiles/.tmux.conf   ~/.tmux.conf

# 改 ~/.zshrc 实际改的是 ~/dotfiles/.zshrc，可以 git commit
```

### ③ 把数据目录搬到大盘但不让应用感知

```bash
$ sudo systemctl stop docker
$ sudo mv /var/lib/docker /mnt/big-disk/docker
$ sudo ln -s /mnt/big-disk/docker /var/lib/docker
$ sudo systemctl start docker
```

Docker 看到的还是 `/var/lib/docker`，实际数据在大盘上。

### ④ `readlink` 看 symlink 指向哪

```bash
$ ls -l /usr/bin/python3
lrwxrwxrwx 1 root root 9 ... /usr/bin/python3 -> python3.10

$ readlink /usr/bin/python3
python3.10

$ readlink -f /usr/bin/python3      # 一直追到最终
/usr/bin/python3.10
```

---

## 7. `cp` / `mv` / `tar` 跟链接的几种坑

```bash
# cp 默认会"跟着" symlink 复制目标内容
$ cp link.txt new.txt
# new.txt 是 original.txt 的副本，不是 symlink

# 要保留 symlink 关系
$ cp -P link.txt new.txt         # P = preserve link
$ cp -a src/ dst/                # -a 包含 -P 等（推荐用于归档）

# mv 跨文件系统会复制再删——硬链接计数会归 1
# mv 同文件系统就是改名（inode 不变）

# tar 默认保留 symlink
$ tar czf backup.tar.gz dir/
# 解压后 symlink 还在
```

`cp -a` 是"几乎不丢任何信息的复制"——保 symlink、保权限、保属主、保时间戳。**做备份首选**。

---

## 8. 现在做一件事

```bash
# 1. 看你 home 下的 symlink
$ find ~ -maxdepth 3 -type l -ls 2>/dev/null | head

# 2. 看 /usr/bin 里有多少是 symlink
$ ls -l /usr/bin | grep -c ^l
# 通常几十个，python3 / pip / vi 等都是 symlink 到具体版本

# 3. 看你磁盘 inode 用量
$ df -ih

# 4. 找当前还被进程持有的"已删除"文件
$ sudo lsof 2>/dev/null | grep deleted | head -5
# 如果有 — 你已经知道为什么 df 没释放了
```

理解 inode 这一层抽象，你就再也不会被"删了为啥没空间""明明有空间为啥写不了"这种问题困扰。

---

> **下一篇**：[mount-and-fs](mount-and-fs)——ext4 / btrfs / zfs / tmpfs 怎么挑、`mount` 命令背后发生了什么、`/etc/fstab` 怎么写、为什么云上服务器经常 LVM 还在。
