---
slug: permissions
title: 权限三段式：rwx / chmod / chown / suid 终极指南
summary: Linux 系列第 11 篇。`-rw-r--r--`、`chmod 755`、`chown root:root`、setuid 这些权限相关的语法新手最容易死记硬背。这一篇把权限模型从底层拆开——为什么是三段、那 9 个 bit 怎么算成数字、suid/sgid/sticky 的用处、ACL 是什么——讲完你看到 `ls -l` 任何输出都能秒读。
tags: [linux, linux-series, permissions, chmod, chown, security]
published_at: 2026-06-24
---

> 这是 Linux 系列的第 11 篇，进入"文件与权限"章。前面讲了"怎么找文件、怎么处理文本"——这一篇讲"为什么有时你看得见、读不了、改不了"。

## 0. 一行 `ls -l` 输出

```
-rw-r--r-- 1 alice  staff  4521 Apr 22 10:15 README.md
```

每一段都有含义：

```
-rw-r--r--   1   alice   staff    4521 Apr 22 10:15 README.md
│└──┬──┘     │    │       │        │
│   │        │    │       │        └─ 大小
│   │        │    │       └─ 属组
│   │        │    └─ 属主
│   │        └─ 硬链接数
│   └─ 权限（9 个 bit）
└─ 文件类型
```

这一篇主要拆解第二段——**9 个 bit 的权限**。

---

## 1. 三段式：u / g / o，每段 r / w / x

Linux 权限的设计极简到惊人：

```
   ┌─ owner (u) ─┐ ┌─ group (g) ──┐ ┌─ others (o) ─┐
   │             │ │              │ │              │
-  rwx           rwx              rwx
│  │││           │││              │││
│  │││           │││              ││└─ 其他人 execute
│  │││           │││              │└── 其他人 write
│  │││           │││              └─── 其他人 read
│  │││           ││└────────────────── 同组 execute
│  │││           │└─────────────────── 同组 write
│  │││           └──────────────────── 同组 read
│  ││└──────────────────────────────── 属主 execute
│  │└─────────────────────────────── 属主 write
│  └──────────────────────────────── 属主 read
└─────────────────────────────────── 文件类型
```

3 段 × 3 权限 = **9 个 bit**。每个 bit 独立：1 就有，0 就无。

| 权限 | 文件 | 目录 |
|---|---|---|
| **r** read | 能 cat / less | 能 ls 列出内容 |
| **w** write | 能改写内容 | 能在里面**新建/删除**文件 |
| **x** execute | 能跑（脚本 / 二进制） | 能 `cd` 进去 / 访问内部文件 |

**目录的 `r` 和 `x` 经常混淆**——记住：

- 有 r 没 x：能 `ls` 看到名字，但访问不了内部任何文件
- 没 r 有 x：能 `cd` 进去、能访问**已知名字**的文件，但 `ls` 列不出
- 同时有 r + x：正常使用

---

## 2. 数字权限：八进制

每段 3 个 bit → 一个 0-7 的数字。所以 `rwxr-xr-x` = `755`。

```
r w x      r - x      r - x
4 2 1      4 . 1      4 . 1
─────      ─────      ─────
  7          5          5
```

对照表：

| 数字 | 二进制 | rwx | 含义 |
|---|---|---|---|
| 0 | 000 | --- | 无 |
| 1 | 001 | --x | 只能执行 |
| 2 | 010 | -w- | 只能写 |
| 3 | 011 | -wx | 写+执行（罕见） |
| 4 | 100 | r-- | 只读 |
| 5 | 101 | r-x | 读+执行 |
| 6 | 110 | rw- | 读+写 |
| 7 | 111 | rwx | 全部 |

记 5 个最常见的：

| chmod | 含义 |
|---|---|
| **755** | 自己改，所有人能读+跑——可执行文件 / 目录的常见值 |
| **644** | 自己改，所有人能读——普通文件常见 |
| **600** | 只有自己读+写——SSH 私钥、密码文件 |
| **700** | 只有自己使用——`~/.ssh/` 目录 |
| **777** | 所有人全权（**几乎一定是错的**——别用） |

---

## 3. `chmod`：改权限

### 数字方式

```bash
$ chmod 755 script.sh         # 给所有人加可执行
$ chmod 644 README.md         # 改回普通文件
$ chmod 600 ~/.ssh/id_rsa     # SSH 私钥必须 600，不然 ssh 拒绝用
```

### 符号方式（更精确）

```bash
$ chmod u+x script.sh         # 给属主加 execute
$ chmod g-w file              # 移除组的 write
$ chmod o=r file              # 让 others 只剩 read
$ chmod a+x script.sh         # all = u+g+o，全部加 x
$ chmod u+x,g-w file          # 一次多条规则

# 递归（小心）
$ chmod -R 755 /var/www/html

# 只改文件不动目录（或反过来）
$ find . -type f -exec chmod 644 {} +
$ find . -type d -exec chmod 755 {} +
```

**`chmod -R 777` 是新手最毁系统的操作**——所有 SSH key 被它一搞 ssh 立刻拒绝登录，所有 systemd 服务起不来，恢复成本巨大。**永远不要 chmod -R 777**。

---

## 4. `chown` / `chgrp`：改属主 / 属组

```bash
# 改属主
$ sudo chown alice file
$ sudo chown alice:devs file       # 同时改属主 + 属组
$ sudo chown :devs file            # 只改属组（前面留空）

# 递归
$ sudo chown -R www-data:www-data /var/www/html

# 复制别人的属性（参考 file，把 file2 调成一样）
$ sudo chown --reference=file file2
```

**只有 root 能 chown**——普通用户不能把文件"送"给别人（防止恶意"嫁祸"）。

---

## 5. suid / sgid / sticky：被忽视但关键的三个 bit

除了 9 个基本 bit，还有 3 个**特殊 bit**，藏在 `chmod 4755` 那个 4 里。

### suid（4000）：跑这个程序时身份切到属主

最经典的例子 `passwd`：

```bash
$ ls -l /usr/bin/passwd
-rwsr-xr-x 1 root root 68208 ... /usr/bin/passwd
   ↑
   s 而不是 x —— suid 已设
```

你（普通用户）跑 passwd 时，进程的 effective uid **变成 root**——这样它能写 `/etc/shadow`（密码文件）。出了 passwd 这个进程，你还是你。

suid 让"普通用户做需要 root 权限的事"成为可能。

```bash
# 设 suid
$ sudo chmod u+s program          # 或 chmod 4755 program
```

**suid 是巨大的安全敏感面**——suid 程序里任何 bug 都能被普通用户提权成 root。**自己写的脚本不要随便 suid**。

> 趣事：很多发行版（Ubuntu 等）**禁用 shell 脚本的 suid**——因为太容易被攻击。即使你 `chmod u+s script.sh` 也不会生效。

### sgid（2000）：

- 用在**目录**上：在目录里新建的文件**自动继承目录的属组**。多人协作目录的标配：

```bash
$ sudo mkdir /srv/shared
$ sudo chown :devs /srv/shared
$ sudo chmod 2775 /srv/shared      # 2 = sgid
# 之后 alice、bob 在 /srv/shared 里建的文件都自动属于 devs 组
```

- 用在**文件**上：跑这个程序时 effective gid 切到文件属组（少见）。

### sticky（1000）：

只对**目录**生效——"只有文件属主能删自己的文件"。

最经典的 `/tmp`：

```bash
$ ls -ld /tmp
drwxrwxrwt 18 root root 4096 ... /tmp
         ↑
         t 而不是 x —— sticky 已设
```

`/tmp` 所有人都能 rwx 写文件——但因为有 sticky，**你的文件别人删不了**（即使他对 /tmp 有 w 权限）。

```bash
$ sudo chmod +t /some/shared/dir
```

---

## 6. umask：新文件的默认权限

新建文件时，权限**不是凭空决定**的——是 `666 - umask`（目录是 `777 - umask`）。

```bash
$ umask
0022           # 默认值（首位是给特殊 bit 的）

$ touch newfile
$ ls -l newfile
-rw-r--r--    # = 666 - 022 = 644

$ umask 077    # 严格点，只有自己能读写
$ touch private
$ ls -l private
-rw-------    # = 666 - 077 = 600
```

写在 `~/.bashrc` 里就是永久的。**家里没人用同一台机器的话** `077` 是最安全的默认值。

---

## 7. ACL：当三段式不够用

三段式（u/g/o）有时不够灵活——比如"我希望 alice 能读，bob 能写，charlie 啥也不能"。这种用 **ACL**（Access Control List）：

```bash
# 看文件 ACL（如果有）
$ getfacl file.txt
# file: file.txt
# owner: me
# group: staff
user::rw-
user:alice:r--          # alice 单独有读权
user:bob:rw-            # bob 读写
group::r--
mask::rw-
other::---

# 加 ACL
$ setfacl -m u:alice:r file.txt          # 给 alice 加读权
$ setfacl -m u:bob:rw file.txt           # 给 bob 加读写
$ setfacl -x u:alice file.txt            # 移除 alice 的特权
$ setfacl -b file.txt                    # 清空 ACL
```

`ls -l` 时有 ACL 的文件末尾会带 `+`：

```
-rw-r--r--+ 1 me staff 0 ... file.txt
         ↑
```

ACL 是 ext4 / xfs / btrfs 等都支持的标准功能。但**优先用三段式 + 合理设组**，ACL 是兜底——它跟备份 / rsync 配合时容易丢失。

---

## 8. 几个"为什么明明 sudo 还不让我写"

### case 1：immutable 属性

```bash
$ sudo touch /tmp/test
$ sudo chattr +i /tmp/test         # +i 加 immutable
$ sudo rm /tmp/test
rm: cannot remove '/tmp/test': Operation not permitted

$ sudo chattr -i /tmp/test         # 取消
$ sudo rm /tmp/test                # OK 了
```

`chattr` 是 ext 文件系统的**扩展属性**，凌驾于 rwx 之上。`+i` 让文件谁也改不了，`+a` 让文件只能追加（适合日志）。

排查"为什么 root 都改不了" → `lsattr file` 看是不是被 chattr 了。

### case 2：文件系统挂成只读

```bash
$ mount | grep '/data'
/dev/sda1 on /data type ext4 (ro,relatime)
                              ↑↑
                              只读
```

整个挂载点 ro，再 chmod 也没用。

### case 3：SELinux / AppArmor

某些发行版（RHEL/Fedora）开了 SELinux——它在 rwx 之上加了一层"什么进程能访问什么类型"的策略。报错通常是 "Permission denied" 但 `ls -l` 看权限明明对。

```bash
$ getenforce         # 看 SELinux 状态
$ ausearch -m avc -ts recent      # 查最近的拒绝日志
```

Ubuntu/Debian 的 AppArmor 类似。

### case 4：容器里的 root 不是真 root

```bash
$ docker run -it alpine sh
# whoami
root
# touch /etc/foo
touch: /etc/foo: Permission denied  # ??? 我是 root 啊
```

如果容器 namespace 配了 `user remapping`、或者 `/etc` 是从宿主机 ro 挂载的、或者 capability 被 drop，root 也写不动。

---

## 9. 实战：一份"刚装好的 Web 服务"权限模板

```bash
# /var/www/myapp 目录给 nginx 用，但 deploy 时由 deploy 用户改
$ sudo chown -R deploy:www-data /var/www/myapp
$ sudo chmod -R 750 /var/www/myapp
$ sudo find /var/www/myapp -type d -exec chmod g+s {} +    # sgid 让新文件继承 group

# 上传目录要 nginx 能写
$ sudo chmod -R g+w /var/www/myapp/uploads

# 私钥严格 600
$ chmod 600 /home/deploy/.ssh/id_rsa
$ chmod 700 /home/deploy/.ssh
```

记忆口诀：

- **目录默认 755**，需要分享写的加 `g+s` + `g+w`
- **文件默认 644**，要执行的 755
- **凭据文件 600**（SSH key、密码、token）
- **不确定时 chmod 750 / 640**——拒绝陌生人，组内有限度

---

## 10. 现在做一件事

```bash
# 1. 看你 home 下隐私文件的权限
$ ls -la ~/.ssh ~/.aws ~/.config 2>/dev/null

# 2. 找权限"太松"的私钥
$ find ~/.ssh -type f -name 'id_*' ! -name '*.pub' -perm /077

# 3. 看系统里所有 suid 程序（理解为什么它们要 suid）
$ find / -perm /4000 -type f 2>/dev/null | head -20

# 4. 看你 umask 现在是几
$ umask
```

如果第 2 步出现了文件——立刻 `chmod 600` 它，ssh 才不会拒绝用。

---

> **下一篇**：[links-inodes](links-inodes)——硬链接、符号链接、inode 到底是什么；为什么 `rm` 大文件后磁盘没释放；ext4 的 inode 用尽了空间还在却写不了文件。
