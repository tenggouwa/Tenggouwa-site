---
slug: systemd-services
title: systemd 全攻略：systemctl / journalctl / .service 文件
summary: Linux 系列第 17 篇。开机自启服务、看日志、定时任务、依赖管理——这些以前要拼接 init 脚本 + crontab + rsyslog 的活，现代 Linux 都让 systemd 一个工具搞定。这一篇拆 systemctl 怎么用、写一个 .service 文件、看 journalctl、配 timer。
tags: [linux, linux-series, systemd, services, journalctl, init]
published_at: 2026-06-30
---

> 这是 Linux 系列的第 17 篇——**进程与并发章节收尾**。前两篇讲了进程怎么来、怎么收信号——这一篇讲怎么让系统**自动**管理这些进程。

## 0. systemd 是什么

Linux 启动后的**第一个用户进程**（PID 1）一定有一个——历史上叫 `init`，今天 95% 的发行版用 **systemd**：

```bash
$ ps -p 1 -o pid,comm
PID COMMAND
  1 systemd
```

systemd 接管的事远不止"启动其他服务"——它一口气吞下了：

- **服务管理**（替代 init scripts、SysV init）
- **日志收集**（journald，替代 syslog 部分功能）
- **定时任务**（systemd timer，替代 cron）
- **网络管理**（systemd-networkd，替代 ifupdown）
- **DNS 解析**（systemd-resolved）
- **登录会话**（logind，管 tty / SSH session）
- **挂载点管理**（automount）

学一个东西管这么多功能——褒贬不一，但现代 Linux 生态已经定型。**这一篇先把"服务管理 + 日志 + 定时"这 3 个最常用的拿下**，剩下用到时再补。

---

## 1. `systemctl`：服务控制

最高频 5 条命令：

```bash
# 状态：服务在跑吗？最近一次怎么了？
$ systemctl status nginx
● nginx.service - A high performance web server
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled; preset: enabled)
     Active: active (running) since Tue 2026-05-25 10:14:23 CST; 2h 30min ago
       Docs: man:nginx(8)
   Main PID: 12345 (nginx)
      Tasks: 5 (limit: 4708)
     Memory: 18.6M
     CGroup: /system.slice/nginx.service
             ├─12345 "nginx: master process"
             └─12346 "nginx: worker process"

# 启 / 停 / 重启
$ sudo systemctl start nginx
$ sudo systemctl stop nginx
$ sudo systemctl restart nginx
$ sudo systemctl reload nginx          # 不重启，发 SIGHUP 重载配置

# 开机自启 / 取消
$ sudo systemctl enable nginx
$ sudo systemctl disable nginx
$ sudo systemctl enable --now nginx    # 一次性：启 + 设自启
```

### 列出系统所有服务

```bash
# 当前活跃的
$ systemctl list-units --type=service

# 所有定义过的（含未启动 / 已停）
$ systemctl list-unit-files --type=service

# 只看挂了的
$ systemctl --failed
```

`--failed` 是开机后第一件事——看哪些服务没起来。

---

## 2. 写一个 .service 文件：让你的进程开机自启

假设你写了一个 Python 脚本 `~/myapp.py`，想让它做成服务跑：

```bash
$ sudo vim /etc/systemd/system/myapp.service
```

最小可用模板：

```ini
[Unit]
Description=My App
After=network.target

[Service]
Type=simple
User=tenggouwa
WorkingDirectory=/home/tenggouwa
ExecStart=/usr/bin/python3 /home/tenggouwa/myapp.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

逐字段解释：

### `[Unit]`：元信息 + 依赖

| 字段 | 含义 |
|---|---|
| `Description=` | 给人看的描述，`systemctl status` 显示 |
| `After=` | "我要在这些之后启动"（network.target 是网络就绪） |
| `Requires=` | "这些必须先成功，我才能起"（更强） |
| `Wants=` | "希望这些先起，但它们失败我也可以起"（最弱） |

### `[Service]`：进程本身

| 字段 | 含义 |
|---|---|
| `Type=simple` | 进程前台跑，systemd 直接 fork+exec（最常用） |
| `Type=forking` | 老式 daemon：进程会自己 fork 后退出，要配 `PIDFile=` |
| `Type=notify` | 进程通过 sd_notify 告诉 systemd "我准备好了" |
| `Type=oneshot` | 跑完就退出（脚本类） |
| `User=`, `Group=` | 用什么身份跑（**不要用 root 跑业务进程**） |
| `WorkingDirectory=` | cwd |
| `ExecStart=` | 主命令（**必须绝对路径**，systemd 不查 PATH） |
| `ExecStartPre=`/`Post=` | 起前 / 起后跑的额外命令 |
| `ExecReload=` | reload 时跑的命令（如 nginx 是 `/usr/sbin/nginx -s reload`） |
| `Restart=on-failure` | **失败时自动拉起**（也可以 always / no） |
| `RestartSec=5` | 重启间隔 5 秒 |
| `Environment="K=V"` | 设环境变量 |
| `EnvironmentFile=` | 从文件读环境变量（推荐放 secret） |
| `StandardOutput=`/`StandardError=` | 输出去哪（默认 journal） |

### `[Install]`：什么时候被启用

```ini
[Install]
WantedBy=multi-user.target
```

意思是"系统进入 multi-user.target（普通多用户运行级别）时拉起我"。**enable 时实际是建一个符号链接**：

```bash
$ sudo systemctl enable myapp
Created symlink /etc/systemd/system/multi-user.target.wants/myapp.service
                → /etc/systemd/system/myapp.service.
```

### 让它跑起来

```bash
$ sudo systemctl daemon-reload      # 改了 unit 文件后必跑
$ sudo systemctl start myapp
$ systemctl status myapp            # 看是不是真的起了
$ sudo systemctl enable myapp       # 开机自启
```

---

## 3. 安全 / 资源限制（强烈推荐加）

业务进程不该裸跑——systemd 提供大量限制选项，**几行配置等于一个迷你容器**：

```ini
[Service]
# ...上面那些...

# 资源限制
MemoryMax=512M               # 超了会被 OOM killer
CPUQuota=50%                 # 最多用半核
TasksMax=100                 # 最多 fork 100 个进程

# 安全沙箱（参考 systemd.exec(5)）
NoNewPrivileges=yes          # 不允许 suid 提权
PrivateTmp=yes               # /tmp 隔离（独立 namespace）
ProtectSystem=strict         # /usr /boot /etc 全部只读
ProtectHome=yes              # /home 不可见
ReadWritePaths=/var/lib/myapp # 唯一可写的路径
PrivateDevices=yes           # 不给硬件访问
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6   # 只准这几类 socket
SystemCallFilter=@system-service  # syscall 白名单
```

这些选项基本上是"零成本"的 hardening——挂上一两行就让你的服务比裸跑安全 N 倍。

> 想看 systemd 自带的所有沙箱选项：`man systemd.exec`，**强烈推荐通读一遍**。

---

## 4. `journalctl`：看日志的标准方式

systemd 的服务 stdout/stderr 默认进 **journald**——一个二进制的日志数据库。要查：

```bash
# 看某服务的日志
$ journalctl -u nginx
$ journalctl -u nginx -n 100         # 最后 100 行
$ journalctl -u nginx -f             # 实时跟（类似 tail -f）

# 按时间段
$ journalctl -u nginx --since "1 hour ago"
$ journalctl -u nginx --since "2026-05-25" --until "2026-05-26"
$ journalctl -u nginx --since today
$ journalctl -u nginx --since "10 min ago"

# 看本次开机以来的（重启后）
$ journalctl -b
$ journalctl -b -1                   # 上次开机的
$ journalctl -b -2                   # 再上次

# 按优先级筛（0=emerg ... 7=debug）
$ journalctl -u nginx -p err          # err 及以上

# 按 PID
$ journalctl _PID=12345

# 实时跟踪某个匹配
$ journalctl -f -u nginx -p warning
```

### 内核日志

```bash
$ journalctl -k                # = dmesg
$ journalctl -k -f             # 实时跟内核消息
```

OOM kill、磁盘错误、网卡 link 状态——都在这里。

### 谁占了 journal 磁盘

```bash
$ journalctl --disk-usage
Archived and active journals take up 1.2G in the file system.

# 限制大小
$ sudo journalctl --vacuum-size=500M
$ sudo journalctl --vacuum-time=7d        # 只保留 7 天
```

或者改配置 `/etc/systemd/journald.conf`：

```ini
SystemMaxUse=500M
MaxRetentionSec=1week
```

---

## 5. systemd timer：cron 的现代替代

要每天凌晨 3 点跑备份脚本——cron 写：

```
0 3 * * * /usr/local/bin/backup.sh
```

systemd timer 写两个文件：

`/etc/systemd/system/backup.service`:

```ini
[Unit]
Description=Daily backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh
```

`/etc/systemd/system/backup.timer`:

```ini
[Unit]
Description=Daily backup timer

[Timer]
OnCalendar=*-*-* 03:00:00        # 每天 3:00
Persistent=true                   # 错过了开机后补跑
RandomizedDelaySec=10min          # 加 10 分钟内随机延迟（避免雷击）

[Install]
WantedBy=timers.target
```

启用：

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now backup.timer

# 看所有 timer
$ systemctl list-timers
NEXT                         LEFT     LAST                         PASSED   UNIT
Wed 2026-05-26 03:00:09 CST  11h left Tue 2026-05-25 03:00:14 CST  12h ago  backup.timer
...
```

### timer 比 cron 强在哪？

1. **跑失败有 journald 日志可查**（cron 默认发邮件，邮件没配的话默默失败）
2. **服务可以被手动 systemctl start 触发**（不用等时间到）
3. **`Persistent=true` 让错过的运行能补**（关机几小时再开机也会补一次）
4. **依赖管理**（timer 可以 `After=` 其他服务）
5. **统一资源限制 / 沙箱**（跟普通 service 一样能用 MemoryMax / NoNewPrivileges）

唯一缺点：要写两个文件，比 cron 一行麻烦。

### `OnCalendar=` 语法速查

```
*-*-* 03:00:00           # 每天 3 点
Mon *-*-* 09:00:00       # 每周一 9 点
*-*-* *:00/15:00         # 每 15 分钟
*-*-01 00:00:00          # 每月 1 号 0 点
hourly  daily  weekly  monthly  yearly   # 简写
```

测试 OnCalendar：

```bash
$ systemd-analyze calendar 'Mon *-*-* 09:00:00'
Normalized form: Mon *-*-* 09:00:00
    Next elapse: Mon 2026-06-01 09:00:00 CST
       From now: 6 days left
```

---

## 6. user-level service：不要 root

systemd 不止 `/etc/systemd/system/`，每个用户还有自己的：

```bash
$ mkdir -p ~/.config/systemd/user
$ vim ~/.config/systemd/user/myapp.service
```

用法一样，但前缀 `--user`：

```bash
$ systemctl --user start myapp
$ systemctl --user enable myapp
$ journalctl --user -u myapp
```

**好处**：

- 不用 sudo
- 服务跟 session 绑（用户登出可能死，除非 `loginctl enable-linger <user>`）
- 写个人自动化脚本最适合

---

## 7. 看 service 的"血缘"和资源占用

```bash
# 看树形视图（哪些 service 属于哪个 slice）
$ systemd-cgls

# 看 CPU/Mem 占用（top 风格）
$ systemd-cgtop

# 看某 service 的所有进程
$ systemctl status nginx
# 或者
$ pgrep -af 'nginx'

# 看 unit 文件实际加载的内容（包含 drop-ins）
$ systemctl cat nginx
```

`systemctl cat` 特别好用——你装一个 service，加了 `/etc/systemd/system/nginx.service.d/override.conf` 改了点东西，**`systemctl cat` 会把所有覆盖逻辑展开给你看**。

---

## 8. 调试一个跑不起来的 service

```bash
# 1. 看 status：systemd 通常告诉你大致原因
$ systemctl status myapp

# 2. 看完整日志
$ journalctl -u myapp -n 50 --no-pager

# 3. 实时跟
$ journalctl -u myapp -f

# 4. 排除 sandbox 配置写错（systemd 沙箱失败也算启动失败）
$ systemd-analyze security myapp.service
# 给你的服务打"安全分"，并列出每条沙箱选项是否阻止它启动

# 5. 手动跑 ExecStart 命令试试
$ sudo -u myuser /usr/bin/python3 /home/myuser/myapp.py
# 能跑就是 systemd 环境的问题（PATH / 工作目录 / 环境变量）
```

systemd 启动失败时最常见的 4 个坑：

1. **ExecStart 不是绝对路径**（写了 `python3 app.py` → 找不到）
2. **WorkingDirectory 没设**，应用读相对路径配置文件失败
3. **PATH / 环境变量没传进来**（systemd 默认 PATH 很短）
4. **沙箱限制太严**（如 `ProtectSystem=strict` 但应用要写 /usr/share）

---

## 9. 一个完整可抄的生产级 unit

把上面所有最佳实践糅在一起——一个能直接抄的 web app 模板：

```ini
[Unit]
Description=My Awesome App
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
EnvironmentFile=/etc/myapp/env
ExecStart=/opt/myapp/.venv/bin/python /opt/myapp/server.py
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s

# 资源
MemoryMax=512M
CPUQuota=80%
TasksMax=200

# 沙箱
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/myapp /var/log/myapp
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=yes
RestrictRealtime=yes
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=myapp

[Install]
WantedBy=multi-user.target
```

读一遍每一行——这就是"生产级"的标准。

---

## 10. 现在做一件事

```bash
# 1. 看你机器上哪些 service 在跑
$ systemctl list-units --type=service --state=running | head -15

# 2. 有失败的吗
$ systemctl --failed

# 3. 今天系统启动用了多久
$ systemd-analyze
Startup finished in 1.234s (kernel) + 6.789s (userspace) = 8.023s

# 4. 哪些 service 启动最慢
$ systemd-analyze blame | head -10

# 5. 看你 systemd 版本
$ systemctl --version | head -1
```

把"开机自启 / 看日志 / 定时跑"这三个最常见的活拿下，systemd 这一坨就够你用 90% 的场景了。

---

> **下一篇**：[net-tools](net-tools)——`ip / ss / dig / curl / nc` 这套现代 Linux 网络工具集，看连接、查路由、查 DNS、测连通、找谁占了端口。
