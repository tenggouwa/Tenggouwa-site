---
slug: fhs-tour
title: 5 分钟逛遍 Linux 根目录：每个文件夹在干什么
summary: Linux 系列第 5 篇。新手登上一台 Linux 第一个困惑就是——`ls /` 看到 20 多个奇怪文件夹，名字全是缩写。这篇按 FHS 标准（Filesystem Hierarchy Standard）把每个目录的职责说清楚，并告诉你装一个新软件，它的文件会撒到哪几个地方。
tags: [linux, linux-series, fhs, filesystem, 入门]
published_at: 2026-06-18
---

> 这是 Linux 系列的第 5 篇——心智模型篇章的收尾。前 4 篇讲了 Linux 是什么、怎么分层、用什么哲学、用什么方法操作；这一篇带你**逛一遍房间**——把每个目录的房牌看清楚。

## 0. 一棵奇怪的树

打开任何 Linux 机器，`ls /` 你会看到：

```bash
$ ls /
bin   dev  home  lib32  libx32  media  opt   root  sbin  srv  tmp  usr
boot  etc  lib   lib64  lost+found  mnt  proc  run   sbin.usr-is-merged
                                                          var
```

20 几个目录，全是 3-4 字母缩写，外加几个看起来像随机的 `lib32 / libx32 / lost+found`。

好消息：**这些是有标准的**——叫 **FHS**（Filesystem Hierarchy Standard），所有主流 Linux 发行版都遵守。坏消息：标准有些历史包袱，几个目录的存在理由已经过时（但还在）。

5 分钟带你过完。

---

## 1. 配置 + 数据 + 程序 的三大块

最重要的心智模型——Linux 把"文件"按生命周期分成三类：

```
┌──────────────────────────────────────────────┐
│  / 程序本体（很少变化、所有用户共享）            │
│   /usr   /bin   /sbin   /lib   /boot          │
├──────────────────────────────────────────────┤
│  / 配置文件（少量变化、明确语义）                 │
│   /etc                                        │
├──────────────────────────────────────────────┤
│  / 数据 / 日志 / 缓存（频繁变化）                 │
│   /var   /tmp   /home                         │
└──────────────────────────────────────────────┘
```

**记住这三块**——下面的目录全是这三块的细分。

---

## 2. 程序本体：`/usr`、`/bin`、`/sbin`、`/lib`、`/boot`

### `/bin` 和 `/sbin`：核心命令

```bash
$ ls /bin | head
bash  cat  cp  ls  mkdir  mv  ps  rm  sh  ...
```

- `/bin` = **B**inaries：所有用户都能用的基本命令（`ls`、`cat`、`bash`）
- `/sbin` = **S**ystem **B**inaries：只有 root 用的命令（`fdisk`、`iptables`、`mount`）

### `/usr`：大部分软件实际住的地方

**`/usr`** 不是 user 的缩写——是 **U**nix **S**ystem **R**esources。这是历史误名。

```bash
/usr/bin/      # 大部分命令真正在这里（python、curl、git ...）
/usr/sbin/     # 大部分系统命令
/usr/lib/      # 共享库 .so 文件
/usr/share/    # 跟架构无关的资源（man 页、字体、locales）
/usr/local/    # 你手动装的软件（不走包管理器）
/usr/include/  # C 头文件
```

> **现代发行版的猫腻**：从 Fedora、Arch 开始，`/bin` 已经只是 `/usr/bin` 的 symlink，`/lib` 是 `/usr/lib` 的 symlink。这叫 **usrmerge**——简化历史包袱。Debian 12 / Ubuntu 24 也都默认 usrmerge 了。

实际定位命令的位置：

```bash
$ which python
/usr/bin/python

$ which docker
/usr/bin/docker

$ which my-self-built-tool
/usr/local/bin/my-self-built-tool   # 自编译的会在这里
```

### `/lib`、`/lib32`、`/lib64`、`/libx32`

`.so`（动态链接库）住的地方。32 位、64 位、x32 ABI 各占一个目录是历史原因——你**几乎不需要碰**。

### `/boot`：内核 + 启动文件

```bash
$ ls /boot
config-5.15.0-92-generic   # 内核编译配置
initrd.img-5.15.0-92      # 启动时早期内存盘
vmlinuz-5.15.0-92         # 内核本体（压缩的 ELF）
grub/                      # 引导器
```

升级内核就是往这里塞新文件。GRUB 启动时读这里。**误删这里你的机器开不了机**——是为数不多需要小心的目录。

---

## 3. 配置：`/etc`

`/etc` 是 **et cetera**（"等等"）的缩写——也是历史命名。今天它的实际含义是 **全局系统配置**。

```bash
/etc/hostname         # 机器名
/etc/hosts            # 本地 DNS（小作弊用：把某域名指向 127.0.0.1）
/etc/passwd           # 所有用户列表
/etc/shadow           # 密码 hash（只有 root 能读）
/etc/group            # 用户组
/etc/fstab            # 启动时挂载哪些盘
/etc/sudoers          # sudo 权限规则
/etc/ssh/             # SSH 服务端配置
/etc/nginx/           # nginx 配置
/etc/systemd/system/  # 你写的自启服务
/etc/cron.d/          # 定时任务
/etc/sysctl.conf      # 内核运行参数
/etc/environment      # 全局环境变量
/etc/network/         # 网络配置（Debian 系）
/etc/netplan/         # 网络配置（Ubuntu 18+）
/etc/resolv.conf      # DNS 服务器列表
```

`/etc` 全是**纯文本文件**（这是 Linux 哲学；对比 Windows 注册表）。这意味着你能 grep、能 diff、能 git 管理、能用 ansible 批量改。

**实战小技巧**：`/etc` 整个目录用 git 跟踪：

```bash
cd /etc && sudo git init && sudo git add . && sudo git commit -m "baseline"
```

之后任何配置改动都能 `git diff` 看到。

---

## 4. 数据：`/var`、`/tmp`、`/home`、`/root`

### `/var`：会"长大"的数据

`/var` = **var**iable。所有运行时会膨胀的东西都在这：

```bash
/var/log/          # 日志（systemd 日志、nginx 日志、应用日志）
/var/lib/          # 应用的持久化数据
  /var/lib/docker/   # Docker 镜像 + 容器
  /var/lib/mysql/    # MySQL 数据
  /var/lib/postgresql/  # Postgres 数据
/var/cache/        # 应用缓存（apt 包缓存、字体缓存）
/var/spool/        # 队列（邮件、打印任务、cron）
/var/tmp/          # 跨重启保留的临时文件（区别于 /tmp）
/var/run/  → /run  # 运行时状态（PID 文件、socket）
```

**磁盘报警 90% 的根因都在 `/var`**——日志不轮转、Docker 镜像不清、apt cache 不清。

排查命令一条：

```bash
$ sudo du -sh /var/* | sort -hr | head
12G  /var/lib/docker
3.2G /var/log
500M /var/cache
...
```

### `/tmp` vs `/var/tmp`

| 目录 | 重启后 | 谁能写 |
|---|---|---|
| `/tmp` | **清空** | 所有人 |
| `/var/tmp` | **保留** | 所有人 |
| `/dev/shm` | 重启清空 + 是内存（不是磁盘） | 所有人 |

正常用 `/tmp`。要传 100GB 文件别走 `/tmp`（很多发行版默认 `/tmp` 是 tmpfs = 内存，会爆）。

### `/home/<user>`：你的个人地盘

```bash
/home/tenggouwa/
├── .bashrc / .zshrc       # 你的 shell 配置
├── .config/               # 现代应用配置（XDG 标准）
├── .cache/                # 个人缓存
├── .local/                # 个人安装的应用
│   └── bin/               # PATH 通常会包含这个，自己装的 CLI 工具放这里
├── .ssh/                  # SSH key + known_hosts
├── Documents/ Downloads/  # 用户文件
└── ...
```

`.` 开头的都是隐藏目录（`ls -a` 才能看到）。XDG 标准把现代应用配置都收进 `.config`、缓存收进 `.cache`——比早期 .每个 app 占一个隐藏文件夹要干净。

### `/root`：root 用户的 home

root 自己住的目录。**不要**放到 `/home/root`——某些场景 `/home` 没挂载时 root 还能登录抢救。

---

## 5. 内核 / 硬件窗口：`/proc`、`/sys`、`/dev`、`/run`

上一篇 [一切皆文件](everything-is-a-file) 已经详细讲过：

```bash
/proc/   # 内核状态 + 每个进程的信息（procfs，不在磁盘）
/sys/    # 硬件 + 驱动 + 内核子系统（sysfs，不在磁盘）
/dev/    # 设备节点（硬盘、终端、随机数 ...）
/run/    # 运行时状态：PID 文件、Unix socket、tmpfs（tmpfs，在内存）
```

**全部不占磁盘**（都是虚拟文件系统）。

---

## 6. 其他不常碰但要知道的

| 目录 | 用途 |
|---|---|
| `/opt` | 可选的第三方软件（独立打包），如 `/opt/google/chrome` |
| `/srv` | 服务对外提供的数据（如 `/srv/www`、`/srv/ftp`），不太常用 |
| `/media` | 自动挂载的可移动介质（U 盘、光盘） |
| `/mnt` | 临时挂载点（手动 `mount` 用） |
| `/lost+found` | ext 文件系统 fsck 时存"孤儿 inode" |

---

## 7. 装一个新软件，文件会撒到哪？

举个具体例子——你 `sudo apt install nginx`，文件会到 7 个地方：

| 路径 | 内容 |
|---|---|
| `/usr/sbin/nginx` | 主程序二进制 |
| `/usr/share/nginx/` | 模板、文档 |
| `/etc/nginx/` | 配置 |
| `/var/log/nginx/` | 日志 |
| `/var/lib/nginx/` | 缓存、临时上传 |
| `/lib/systemd/system/nginx.service` | systemd unit |
| `/usr/share/man/man8/nginx.8.gz` | man 页 |

是不是觉得"分得有点散"？这是为了——

- 备份时只需要打包 `/etc` + `/var`（程序本体重新装就行）
- 升级时 `/usr` 整个被替换，`/etc` 配置保留
- 容器化时 read-only 挂 `/usr`，read-write 只给 `/var`

**这种"按生命周期分目录"的设计就是 FHS 的核心智慧**——一旦你看懂了，你打开任何陌生 Linux 都知道东西在哪。

---

## 8. 现代变种：不完全遵守 FHS 的发行版

- **NixOS**：`/usr` 几乎是空的，所有程序住 `/nix/store/<hash>-name/`，从根本上跳出了 FHS
- **Container 镜像**：很多镜像（特别是 Alpine、scratch）只保留 `/bin` `/lib` `/etc` 这些最小子集
- **macOS**：用 BSD 风的 `/Applications`、`/Library`、`/Users`——长得跟 Linux 完全不一样，但概念对应（`/Users` ≈ `/home`，`/Library` 部分 ≈ `/var`）

但你只要懂了 FHS 的**精神**（按生命周期分目录），看任何变种都能映射过去。

---

## 9. 现在做一件事

打开你的终端，跑：

```bash
$ ls / | xargs -I {} sh -c 'echo "== /{}"; ls /{} 2>/dev/null | head -5; echo'
```

这条命令会自动列出根下每个目录的前 5 个内容。逐一对照本文确认你知道每个在干什么。

碰到看不懂的，`man hier`（hierarchy 的缩写）—— Linux 自带的 FHS 速查手册：

```bash
$ man hier
```

读完你就毕业了——心智模型篇章到此结束。

---

> **下一篇**：[finding-things](finding-things)——日常 shell 工具篇章开始。`find / fd / grep / rg / locate` 怎么挑、怎么用、性能差几个量级。
