---
slug: why-linux
title: 为什么世界 95% 的服务器都是 Linux
summary: Linux 系列第 1 篇。先不教命令——先想清楚一件事：你的 Mac / 手机 / 服务器 / 路由器背后那个一直没存在感的"操作系统"，怎么就赢了所有竞争对手，统治了几乎整个互联网。理解 Linux 为什么是 Linux，比死记命令重要 10 倍。
tags: [linux, linux-series, 入门, 时间线]
published_at: 2026-06-14
---

> 这是 Linux 系列的第 1 篇。系列目标：把 Linux 学到能"住下来"——不管是 VPS、Docker、WSL、还是树莓派，打开终端就有家的感觉。
> 完整路线图见仓库 `docs/linux-series-plan.md`（待补）。

## 0. 先看一个数字

W3Techs 的最新统计：

```
互联网公网服务器 OS 占比：
  ┌─────────────────────────────────┐
  │ Linux         ████████████ 96.4% │
  │ Windows       █             1.9% │
  │ FreeBSD       ▏             0.4% │
  │ Other         ▏             1.3% │
  └─────────────────────────────────┘
```

你今天刷的每一个网页，访问的每一个 API，下载的每一个包，背后**几乎肯定**是一台 Linux 在干活。

更有意思的对比：

- **桌面**：Windows 70% / macOS 20% / Linux 4%
- **手机**：Android 70%（Linux kernel）/ iOS 30%（XNU，类 Unix）
- **服务器**：Linux 96%
- **超级计算机 TOP 500**：Linux **100%**（连续 9 年）
- **航天器、登月车、空间站**：基本都跑某种 Linux 变体

桌面输得很惨的 Linux，在你看不见的所有地方都赢了。这篇就讲：**为什么**。

---

## 1. Linux 的来历，用 5 分钟串完

故事起源于一封邮件。1991 年 8 月，芬兰赫尔辛基大学，21 岁的 Linus Torvalds 在 comp.os.minix 这个新闻组发了帖子：

> Hello everybody out there using minix —
> I'm doing a (free) operating system (just a hobby, won't be big and professional like gnu) for 386(486) AT clones.

中文意思："我在做一个免费的操作系统，就是个爱好，不会像 GNU 那样大那么专业"。

这封"自谦"的邮件后来被印在无数 T 恤上。三十几年过去——

```
1969  Bell Labs · Ken Thompson + Dennis Ritchie 写出 Unix
       ↓ Unix 商业化、分裂成 BSD / System V / AIX / HP-UX / Solaris……
1983  Richard Stallman 启动 GNU 项目：要写一套"自由"的 Unix
       ↓ GNU 写出了 gcc / bash / coreutils / emacs，但内核 (Hurd) 难产
1991  Linus 写出 Linux 内核（其实只是个内核）
       ↓ GNU 的工具 + Linux 内核 = 完整的操作系统，叫 GNU/Linux
1994  Linux 1.0 发布
1996  Apache 跑在 Linux 上，开始统治 Web
2003  Red Hat 上市，Linux 商业化成功
2008  Android 发布（用 Linux 内核）
2016  微软：「Microsoft loves Linux」+ WSL 上线
2025  AI 训练集群、云原生、IoT、车机、空间站，全是 Linux
```

关键转折点是 **Unix 商业化后陷入版权战争**——AT&T / SCO / IBM 这帮公司各自分叉、互相起诉，把 Unix 撕成了几十块互不兼容的小生态。这时候**自由的、开源的、能跑在便宜 x86 PC 上**的 Linux 出现了，成本和生态优势直接碾压。

> 一句话总结：**Unix 是地基，GNU 是地板，Linux 是承重墙，社区把它装修成了所有人的家。**

---

## 2. 服务器为什么选 Linux，不选 Windows

把感性的"它就是好"翻译成 5 个具体维度：

### ① 稳定性

Linux 服务器**正常情况下开机几年不重启**。我见过 uptime 显示 1800 多天的机器——五年没动，Web 服务持续在跑。Windows Server？年度 patch、季度重启、月度蓝屏，被各种"驱动签名"和"许可证服务"折腾。

```bash
$ uptime
 23:14:08 up 1832 days,  4:21,  1 user,  load average: 0.08, 0.12, 0.15
```

### ② 资源占用

| 指标 | Linux (Alpine) | Linux (Ubuntu Server) | Windows Server 2022 |
|---|---|---|---|
| 最小内存 | 32 MB | 512 MB | 2 GB |
| 磁盘占用 | 5 MB | 1.5 GB | 30 GB+ |
| 进程数 | 几十 | 一百多 | 数百 |

你那台 1G 内存的 VPS 在 Linux 下还能多塞 5 个服务；换 Windows 直接开机即满。

### ③ 远程管理是一等公民

Linux 从第一天起就假设"管理员根本不会坐在屏幕前"。SSH 是标配，所有运维操作都能脚本化、可重复执行：

```bash
ssh user@server "sudo apt update && sudo apt upgrade -y"
```

Windows 的远程管理至今还在 RDP（图形）和 PowerShell Remoting 之间反复横跳，自动化体验差出几个量级。

### ④ 一切可编程

Linux 的设计哲学是 **"一切皆文件，配置即文本"**。

- 改个 IP？编辑 `/etc/network/interfaces`
- 装个服务？写一个 `xxx.service` 文件到 `/etc/systemd/system/`
- 调内核参数？`echo 1 > /proc/sys/net/ipv4/ip_forward`

每一件事都是**文本操作**——可以 diff、可以 commit、可以 ansible、可以"基础设施即代码"。Windows 的注册表 + 各种 MMC 控制台，每一项都是"打开图形界面点一下"，自动化路径非常间接。

### ⑤ 成本与可控

- License：免费、商用免费
- 内核：开源、出 bug 能自己改
- 生态：Docker / Kubernetes / NGINX / PostgreSQL 全是先支持 Linux

只有一件事 Linux 输了：**桌面**。原因后面会专门讲（Linus 自己最近也认了：「我们桌面没赢，但其他地方都赢了，可以了」）。

---

## 3. Linux 的"形状"：一个内核，千万个发行版

新手最容易迷的就是 **"Ubuntu / CentOS / Alpine / Debian / Arch ……都是 Linux 吗？"**

是。它们共享同一个 kernel（Linus 维护的那个），但在外面套了不同的 **userspace**（包管理器 + 默认软件 + 配置风格 + 社区文化）：

```
┌─────────────────────────────────────────────────┐
│  各种发行版（"装修"）                              │
│  Ubuntu  Debian  CentOS  Alpine  Arch  NixOS    │
├─────────────────────────────────────────────────┤
│  GNU 工具集 + 系统库（"家具"）                     │
│  bash / coreutils / glibc / systemd ...         │
├─────────────────────────────────────────────────┤
│  Linux 内核（"地基与承重墙"）                       │
│  进程调度 / 内存 / 文件系统 / 网络协议栈             │
├─────────────────────────────────────────────────┤
│  硬件                                            │
└─────────────────────────────────────────────────┘
```

挑发行版就像挑装修风格：

- **Ubuntu / Debian**：apt 包管理，新手友好，文档最多
- **RHEL / CentOS / Rocky / Alma**：dnf/yum，企业生产标准
- **Alpine**：musl libc + apk，几 MB 起，Docker 镜像首选
- **Arch / NixOS**：滚动更新 / 声明式，给自虐爱好者

你不用纠结：**这个系列里大部分操作在任何主流发行版都通用**。

### 顺便说几个"它是 Linux 吗？"

| 系统 | 内核 | userspace | 算 Linux？ |
|---|---|---|---|
| Android | Linux | 自家 + Java VM | ✅ 内核是 |
| ChromeOS | Linux | Chromium + 自家 | ✅ |
| macOS | XNU（Mach + BSD） | BSD 系工具 | ❌ 但 POSIX 兼容 |
| iOS | XNU | 自家 | ❌ |
| WSL2 | Linux | Linux 完整 | ✅ 真的是 |
| Docker 容器 | 宿主机的 Linux | 镜像里的 | ✅ |

**重要**：你的 Mac 不是 Linux，但**绝大部分 shell 操作完全通用**。这个系列你在 Mac 上跟着敲也没问题——少数 Linux 专有的地方（systemd / `/proc` / iptables 等）我会标出来。

---

## 4. 学 Linux 到底在学什么

如果你以为学 Linux 是背 1000 个命令——错了，那是搜索引擎的工作。

学 Linux 是学一种**思维方式**：

> **"小工具 + 文本流 + 组合 + 可观察"**

具体说：

1. **一切皆文件**：硬盘、网卡、socket、进程信息、内核参数——全是文件树里的某个路径，你用 `cat / echo / grep` 就能读写
2. **小工具，做一件事，做对**：每个命令只解决一类问题（`cut` 只切列，`sort` 只排序），但**用管道串起来**能解决任何问题
3. **显式优于隐式**：所有状态都在文件里，没有"注册表"这种黑箱
4. **可观察**：机器现在在干什么？`/proc/<pid>` 给你看进程的一切。`top / strace / iotop` 让你直接窥视内核
5. **可脚本化**：能 GUI 做的事，shell 一定能做；能用 shell 做的事，一定可以放进 cron / systemd timer 让它自动跑

学会这套，**你就能在任何 Linux 上"住下来"**——不管是云 VPS、Docker 容器、WSL、还是别人发给你 root 让你帮忙救服务的陌生机器。

---

## 5. 这个系列你会学到什么

按章节速览（25 篇）：

```
Ⅰ. 心智模型       (1-5)    why-linux / kernel / 一切皆文件 / shell 哲学 / 目录结构
Ⅱ. 日常 shell 工具 (6-10)   find/grep / 文本管道 / 重定向 / 进程控制 / rc 配置
Ⅲ. 文件与权限     (11-14)  rwx / 链接 inode / 挂载 / 备份同步
Ⅳ. 进程与并发     (15-17)  fork/exec / 信号 / systemd
Ⅴ. 网络          (18-20)  ip/ss / 防火墙 / SSH 高阶
Ⅵ. 性能与调试     (21-23)  observability / 日志 / 内核调优
Ⅶ. 容器与部署     (24-25)  容器原理 / VPS 上手清单
```

每篇 8-12 分钟读完，**全部带可执行命令**，复制粘贴就能跟着跑。

---

## 6. 现在做一件事

打开你的终端（Mac 的 Terminal.app、Linux 的任何终端模拟器、Windows 的 WSL），敲：

```bash
$ uname -a
```

你会看到类似这样：

```
# Linux 上
Linux ubuntu-server 5.15.0-92-generic #102-Ubuntu SMP x86_64 GNU/Linux

# Mac 上
Darwin laptop.local 24.6.0 Darwin Kernel Version 24.6.0 ... arm64
```

**逐字段拆开**：

- `Linux` / `Darwin`：内核名
- `ubuntu-server` / `laptop.local`：机器的 hostname
- `5.15.0-92-generic`：内核版本号
- `x86_64` / `arm64`：CPU 架构
- `GNU/Linux`：用户空间是 GNU 工具集（Mac 上没有这行）

如果你的输出是 **Darwin**，欢迎——本系列大部分内容你都通用，差异处我会标注 `# macOS:`。

如果是 **Linux** 任意发行版，更欢迎——你已经站在了系列的正中央。

---

> **下一篇**：内核和用户态到底怎么分工——你敲下一条 `ls` 命令，机器内部发生了什么。
