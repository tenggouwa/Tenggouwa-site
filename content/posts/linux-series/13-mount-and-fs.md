---
slug: mount-and-fs
title: 挂载与文件系统：ext4 / btrfs / xfs / tmpfs 怎么挑、mount 在干啥
summary: Linux 系列第 13 篇。"块设备—文件系统—挂载点"是 Linux 存储的三件套。理解 mount 命令背后是怎么把一堆字节变成你能 ls 的目录、/etc/fstab 怎么写、ext4 / btrfs / xfs / tmpfs 各自的甜点场景，你就能在任何机器上"加一块盘"或"找出哪块盘满了"。
tags: [linux, linux-series, filesystem, mount, ext4, btrfs, fstab]
published_at: 2026-06-26
---

> 这是 Linux 系列的第 13 篇。上一篇拆开了"文件"这个抽象——这一篇往下一层：文件**所在的那块"盘"**到底是什么、怎么接到系统上。

## 0. 三个名词先分清

```
块设备（block device）          ┐
   /dev/sda、/dev/nvme0n1、     │ 硬件层（或虚拟硬件）
   /dev/loop0                  ┘
                                
文件系统（filesystem）           ┐  
   ext4 / btrfs / xfs / vfat    │ 把块设备格式化后才有的"目录树"格式
                                ┘
                                
挂载点（mount point）            ┐
   /、/home、/mnt/data          │ 文件系统接入目录树的位置
                                ┘
```

类比："**硬盘**是空白本子（块设备），**格式化**像在本子上画好横线规则（文件系统），**mount** 是把这个本子接到图书馆的某个书架位置（挂载点）"。

`ls /home` 就是查看接在 `/home` 这个位置的本子。

---

## 1. 看一眼你机器现在挂了什么

```bash
$ mount | head -10
proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)
sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)
/dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)
tmpfs on /run type tmpfs (rw,nosuid,nodev,size=204800k,mode=755)
/dev/sda1 on /home type ext4 (rw,relatime,errors=remount-ro)
tmpfs on /tmp type tmpfs (rw,nosuid,nodev,size=2048M)
...
```

每行：`<块设备> on <挂载点> type <fs 类型> (<选项>)`。

更易读的工具：

```bash
$ findmnt
TARGET               SOURCE     FSTYPE  OPTIONS
/                    /dev/sda1  ext4    rw,relatime,errors=remount-ro
├─/proc              proc       proc    rw,nosuid,nodev,noexec,relatime
├─/sys               sysfs      sysfs   rw,nosuid,nodev,noexec,relatime
├─/run               tmpfs      tmpfs   rw,nosuid,nodev,size=204800k
├─/dev/shm           tmpfs      tmpfs   rw,nosuid,nodev
├─/home              /dev/sda2  ext4    rw,relatime
└─/mnt/data          /dev/sdb1  xfs     rw,relatime
```

`findmnt` 用树形展示更直观，强烈推荐。

### 看磁盘使用

```bash
$ df -h                     # 按挂载点列空间
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   28G   22G  56% /
/dev/sdb1       500G   89G  411G  18% /mnt/data
tmpfs           2.0G  120M  1.9G   6% /tmp

$ df -ih                    # 按 inode 列（上一篇讲过）
$ df -T                     # 也显示 fs 类型
```

### 看块设备

```bash
$ lsblk
NAME    SIZE  TYPE MOUNTPOINTS
sda      50G  disk
├─sda1   49G  part /
└─sda2    1G  part [SWAP]
sdb     500G  disk
└─sdb1  500G  part /mnt/data
nvme0n1 1.0T  disk
└─nvme0n1p1 1.0T part /var/lib/docker
```

`lsblk` 是看"机器上有多少盘、每盘怎么分区、挂在哪"的最好工具。**没挂载的盘**这里也能看到。

---

## 2. 主流文件系统怎么挑

| FS | 甜点 | 不适合 |
|---|---|---|
| **ext4** | 默认、最稳、跨发行版兼容 | 单文件超过 16TB；高并发数据库（可选别的） |
| **xfs** | 大文件、高并发 I/O、生产服务器 | 不能在线缩小（只能扩） |
| **btrfs** | 快照、子卷、压缩、checksum | 历史上 RAID5/6 不稳；某些场景内存压力大 |
| **zfs** | 同上 + 更成熟、双向 dedup、ARC 缓存 | 内存吃得多（"1GB RAM per 1TB data" 经验值）、license 复杂 |
| **tmpfs** | 全在 RAM，重启即清空 | 任何不能丢的数据 |
| **vfat / exFAT** | U 盘、跨 Win/Mac 兼容 | 不支持 Unix 权限、单文件最大 4GB（vfat） |

**给一台普通服务器选**：

- 系统盘：**ext4**（默认就好，不折腾）
- 数据盘：**xfs**（如果数据量大）或 **ext4**（如果省事）
- 想要快照 / 备份：**btrfs** 或 **zfs**
- 容器跑临时数据：直接用 host 的 ext4，别折腾

---

## 3. `mount` 命令：手动接一块盘

假设你刚 attach 了一块新的 EBS / 阿里云数据盘，系统里识别为 `/dev/vdb`：

```bash
# 1. 看一眼是不是真的没格式化过
$ sudo lsblk -f /dev/vdb
NAME FSTYPE LABEL UUID SIZE MOUNTPOINTS
vdb               500G                     ← FSTYPE 为空 = 没格式化

# 2. 格式化（这一步会清空数据，注意）
$ sudo mkfs.ext4 /dev/vdb              # ext4
# 或
$ sudo mkfs.xfs /dev/vdb               # xfs

# 3. 建挂载点
$ sudo mkdir -p /mnt/data

# 4. 挂载
$ sudo mount /dev/vdb /mnt/data

# 5. 验证
$ df -h /mnt/data
/dev/vdb        492G   28K  468G   1% /mnt/data
```

### 已格式化的盘直接挂

```bash
# 跨 Linux 系统迁移一块盘？直接 mount 就行（FS 一致的话）
$ sudo mount /dev/vdb /mnt/data

# 指定 FS 类型（可选；mount 通常能自动识别）
$ sudo mount -t ext4 /dev/vdb /mnt/data

# 只读挂载（保护数据安全）
$ sudo mount -o ro /dev/vdb /mnt/data
```

### 卸载

```bash
$ sudo umount /mnt/data
# 如果有进程占用导致 busy：
$ sudo umount -l /mnt/data    # lazy umount（卡进程时用）
$ sudo fuser -vm /mnt/data    # 查谁占着
```

> **注意**：是 `umount` 不是 `unmount`——这是 Unix 老命名癖好。

---

## 4. `/etc/fstab`：开机自动挂

每次开机手动 mount 太蠢。`/etc/fstab` 描述"启动时该挂哪些盘"：

```bash
$ cat /etc/fstab
# <file system>            <mount point>  <type>  <options>           <dump> <pass>
UUID=abc-123-def           /              ext4    defaults,errors=remount-ro 0 1
UUID=987-654-321           /home          ext4    defaults            0      2
UUID=fed-789-cba           /mnt/data      xfs     defaults,noatime    0      2
/swap.img                  none           swap    sw                  0      0
tmpfs                      /tmp           tmpfs   defaults,size=2G    0      0
```

字段：

1. **设备**：推荐 `UUID=...`（盘换位置不会失效）；用 `/dev/sda1` 也行但脆
2. **挂载点**：`/mnt/data` 这种路径
3. **fs 类型**：`ext4` / `xfs` / `auto`
4. **选项**：见下面
5. **dump**：备份相关（一般 0）
6. **pass**：fsck 顺序（`/` = 1，其他 = 2，不检查 = 0）

### 拿到 UUID

```bash
$ sudo blkid /dev/vdb
/dev/vdb: UUID="abc-123-def..." TYPE="ext4"

# 或者
$ lsblk -f
```

### 常用挂载选项

| 选项 | 含义 |
|---|---|
| `defaults` | rw,suid,dev,exec,auto,nouser,async |
| `noatime` | **强烈推荐**：不更新文件 access 时间，能减少 30% IO |
| `nodev` | 不让这个 fs 上有设备文件（安全） |
| `nosuid` | 忽略 suid bit（安全） |
| `noexec` | 不允许执行（适合 /tmp 等用户上传目录） |
| `ro` / `rw` | 只读 / 读写 |
| `discard` | SSD：删文件时通知设备做 TRIM |

**加 `noatime` 几乎免费提性能**——大多数应用根本不在意 atime。

### 改完测试不重启

```bash
# 检查语法
$ sudo mount -a

# 看是否所有 fstab 条目都成功
$ findmnt --verify
```

`mount -a` 会按 fstab 重挂所有**当前没挂**的。如果挂载错的语法被解析到 systemd，开机会卡——所以**改完一定 `mount -a` 测一遍**。

> **救场技巧**：fstab 写错导致开机卡死，可以从 grub 进 single user 模式，或者在挂载点选项后加 `nofail` 让它失败也不阻塞启动。

---

## 5. 几个"伪文件系统"

不是所有挂载点都对应真实硬件——很多是**内核虚拟出来的**：

```bash
$ findmnt | head
TARGET           SOURCE    FSTYPE
/                /dev/sda1 ext4
├─/proc          proc      proc        ← 进程信息（看上篇）
├─/sys           sysfs     sysfs       ← 硬件 / 驱动
├─/dev           devtmpfs  devtmpfs    ← 设备节点
├─/dev/shm       tmpfs     tmpfs       ← 共享内存
├─/run           tmpfs     tmpfs       ← 运行时状态（PID 文件等）
├─/sys/fs/cgroup cgroup2   cgroup2     ← 容器/调度组
└─/proc/sys/fs/binfmt_misc binfmt_misc binfmt_misc
```

它们在内存里，不占磁盘——重启什么都没了。**`/tmp` 在很多发行版（Fedora、Ubuntu 22+）默认就是 tmpfs**——你写 10G 到 /tmp 会占 10G **内存**而不是磁盘，机器轻易 OOM。

```bash
# 看你的 /tmp 是不是 tmpfs
$ findmnt /tmp
TARGET SOURCE FSTYPE OPTIONS
/tmp   tmpfs  tmpfs  rw,nosuid,nodev,size=2G
```

是 tmpfs 的话，要传大文件**绝对不要走 /tmp**，用 `/var/tmp` 或 `/home`。

---

## 6. swap：磁盘当内存用

swap 是"内存不够时把不活跃页扔磁盘"的兜底。**不是必须**——但对 1-2G 小机器很有用（参考前面阿里云 1G 救命那次）。

### 加 swap 文件（不需要单独分区）

```bash
$ sudo fallocate -l 2G /swapfile
$ sudo chmod 600 /swapfile
$ sudo mkswap /swapfile
$ sudo swapon /swapfile

# 验证
$ swapon --show
NAME      TYPE  SIZE USED PRIO
/swapfile file    2G   0B   -2

$ free -h
              total        used        free      shared  buff/cache   available
Mem:           2.0Gi       1.1Gi       213Mi        21Mi       720Mi       734Mi
Swap:          2.0Gi          0B       2.0Gi

# 让开机也挂上
$ echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### swap 跟内存平衡：vm.swappiness

```bash
$ cat /proc/sys/vm/swappiness
60         # 默认 60

# 服务器建议调低，让内核优先用内存
$ echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
$ sudo sysctl -p
```

值范围 0-200。低 = 不轻易 swap；高 = 容易 swap。**SSD 时代不要怕 swap**，比 OOM 死掉好。

---

## 7. LVM 一句话扫盲

云上你不一定碰到，但**家用服务器 / 物理机**经常看到挂载点是 `/dev/mapper/vg0-root` 这种——这是 **LVM**（Logical Volume Manager）。

LVM 加了一层抽象：

```
物理硬盘 (PV: physical volume)
    └─ 卷组 (VG: volume group) = 一堆 PV 合并
            └─ 逻辑卷 (LV: logical volume) = 从 VG 切一块出来当"盘"用
```

好处：

- 可以**在线扩容**（把 LV 加大 5G，文件系统接着扩，不用重启）
- 可以**跨多块物理盘**虚拟成一个大盘
- 支持**快照**（mysqldump 前先 snap，备份完即时回滚）

```bash
# 看 LVM 现状
$ sudo pvs              # 物理卷
$ sudo vgs              # 卷组
$ sudo lvs              # 逻辑卷

# 在线扩 /data：先扩 LV，再扩文件系统
$ sudo lvextend -L +10G /dev/vg0/data
$ sudo resize2fs /dev/vg0/data      # ext4
$ sudo xfs_growfs /mnt/data         # xfs
```

云上一般不用 LVM（云盘本身能在线扩），但**物理机 / OpenStack 旧实例**会有。看到 `/dev/mapper/...` 你就知道下面是 LVM。

---

## 8. 实战清单：刚买一块新数据盘怎么挂

```bash
# 1. 看是哪个设备名
$ lsblk
# 找到那个还没 MOUNTPOINTS 的 disk，比如 /dev/vdb

# 2. 看清楚不是误识别（防止误格式化系统盘！）
$ sudo blkid /dev/vdb     # 应该没输出（未格式化）

# 3. 选 fs 格式化
$ sudo mkfs.ext4 -L data /dev/vdb     # -L 加 label 方便后续识别

# 4. 建挂载点 + 挂
$ sudo mkdir -p /mnt/data
$ sudo mount /dev/vdb /mnt/data

# 5. 拿 UUID 写 fstab（用 UUID 不用 /dev/vdb，避免插拔顺序变了开不了机）
$ UUID=$(sudo blkid -s UUID -o value /dev/vdb)
$ echo "UUID=$UUID /mnt/data ext4 defaults,noatime 0 2" | sudo tee -a /etc/fstab

# 6. 验证开机也能挂
$ sudo umount /mnt/data
$ sudo mount -a
$ df -h /mnt/data        # 又出现了 → fstab 没写错
```

整个流程 5 分钟。值得熟练。

---

## 9. 现在做一件事

```bash
# 1. 看你机器目前所有挂载点
$ findmnt -t notmpfs,devtmpfs,proc,sysfs,cgroup2

# 2. 看哪些盘空间最紧张
$ df -h | sort -k5 -hr | head

# 3. 看你的 / 是什么文件系统、哪些挂载选项
$ findmnt /

# 4. 看 swap 现状
$ free -h
$ swapon --show

# 5. 如果是云上 SSD，看 / 是否启用了 discard
$ findmnt -o SOURCE,TARGET,FSTYPE,OPTIONS / | grep -o discard || echo "未开 discard"
```

理解你脚下踩的"地板"长什么样——这是日常救火的基本功。

---

> **下一篇**：[archive-rsync](archive-rsync)——`tar / gzip / zstd / rsync` 怎么打包、压缩、增量同步；同一份数据从笔记本同步到服务器要 30 秒还是 3 小时，区别就在这几个命令的选项里。
