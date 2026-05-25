---
slug: logs
title: 日志去哪了：journalctl / syslog / logrotate 一次说清
summary: Linux 系列第 22 篇。"应用挂了——日志在哪？"——这个问题答案随系统版本和应用类型变化巨大。本篇拆开三条主线：systemd journal、传统 syslog、应用自己的日志文件，并给出 logrotate 配置防止磁盘被日志撑爆（这是雪崩第二大杀手）。
tags: [linux, linux-series, logs, journalctl, syslog, logrotate]
published_at: 2026-07-05
---

> 这是 Linux 系列的第 22 篇。上一篇讲怎么看机器状态——这一篇专题讲"机器发生过什么"——日志。

## 0. 三条日志路线，新手要先认全

Linux 上日志去哪儿，本质是看应用怎么写的：

```
应用 A：写 stdout/stderr               →  systemd → journald → /var/log/journal/
应用 B：调 syslog() 函数               →  /dev/log → rsyslog/syslog-ng → /var/log/*.log
应用 C：自己 open 文件 write           →  /var/log/<app>/ 或别的位置
```

现代 systemd 系统 + 主流软件 →  **路线 A（journald）**最常见。
NGINX / 数据库这类老软件 → 多半**自己写文件**（路线 C）。
邮件 / DHCP / 内核老组件 → **syslog**（路线 B）。

下面分别讲。

---

## 1. 路线 A：systemd journal（最现代）

systemd 的服务 stdout/stderr 默认进 journald。已经在 [17 systemd-services](systemd-services) 讲过 journalctl，这里补几个**进阶 trick**。

### 最高频 5 条命令

```bash
# 跟某服务的日志
$ journalctl -u nginx -f
$ journalctl -u nginx --since '10 min ago'
$ journalctl -u nginx -p err              # 错误及以上

# 系统所有错误（救火第一条）
$ journalctl -p err -b                    # 本次启动以来的错误

# 内核日志
$ journalctl -k

# 按某 PID 过滤
$ journalctl _PID=12345

# 按可执行文件过滤
$ journalctl /usr/bin/python3
```

### journal 输出格式

```bash
# JSON 格式（适合脚本）
$ journalctl -u nginx -o json

# 紧凑 JSON
$ journalctl -u nginx -o json-pretty

# 仅纯消息（无元数据）
$ journalctl -u nginx -o cat

# verbose 显示所有字段
$ journalctl -u nginx -o verbose
```

`verbose` 输出会让你看到 journal 收集了多少额外字段（_PID / _UID / _COMM / _BOOT_ID / _SYSTEMD_UNIT / _HOSTNAME...）——这些字段都能用 `key=value` 过滤：

```bash
$ journalctl _SYSTEMD_UNIT=nginx.service _PID=12345 PRIORITY=3
```

### 一个杀手 trick：跨多条件 `--grep`

```bash
$ journalctl -u nginx --grep "5\d\d" -p notice    # 含 5xx 状态码的 nginx notice
```

### 加 SyslogIdentifier 给自己应用打 tag

写 .service 文件时加：

```ini
[Service]
SyslogIdentifier=myapp
```

之后：

```bash
$ journalctl -t myapp -f
```

不用记 unit 名。

---

## 2. 路线 B：传统 syslog

`syslog` 是 Unix 1980 年代的日志协议。今天的实现一般是 **rsyslog** 或 **syslog-ng**。

```bash
# 看 syslog 的"主入口"
$ ls /var/log/
syslog          messages    auth.log    kern.log    mail.log
syslog.1.gz     messages.1  auth.log.1  ...
```

这些是应用调 `syslog()` 函数后，rsyslog 根据规则**分流**到的文件。

### syslog 的 facility（设施）+ severity（级别）

应用调 syslog 时带两个参数：

| facility | 默认日志去哪 |
|---|---|
| kern | /var/log/kern.log |
| auth, authpriv | /var/log/auth.log |
| mail | /var/log/mail.log |
| cron | /var/log/cron.log |
| daemon | /var/log/daemon.log |
| user | /var/log/user.log |
| local0..local7 | 自定义用 |

| severity | 含义 |
|---|---|
| 0 emerg | 系统不可用 |
| 1 alert | 立刻处理 |
| 2 crit | 严重 |
| 3 err | 错误 |
| 4 warning | 警告 |
| 5 notice | 通知 |
| 6 info | 信息 |
| 7 debug | 调试 |

### rsyslog 配置

```bash
# 主配置
$ sudo cat /etc/rsyslog.conf
$ ls /etc/rsyslog.d/
```

典型规则一行：

```
mail.*                                  /var/log/mail.log
authpriv.*                              /var/log/auth.log
*.err                                   /var/log/err.log
local0.*                                /var/log/myapp.log
```

读法：`<facility>.<severity-及以上>  <文件路径>`。

### 现代用法

systemd-journald 在大多发行版上同时也会把日志**转发给 rsyslog**——所以两边都有。`/var/log/syslog` 和 `journalctl` 显示的内容很大部分重叠。

**新业务直接走 journald 就行**——文本日志慢慢退场。但**老软件、远程集中化日志**还是 syslog 的天下。

### 远程集中化（一句话）

rsyslog / syslog-ng 都支持把日志**转发到中央 log server**。常见架构：

```
N 台业务机器 → rsyslog → 中央日志机 → Elasticsearch/Loki → Kibana/Grafana
```

云上更常用 vector / fluent-bit + 对接 SLS / CloudWatch / Loki。这是单独的话题。

---

## 3. 路线 C：应用自己的日志文件

NGINX、PostgreSQL、Redis、Java 应用——很多软件**自己 open 文件写**，不走 journald 也不走 syslog。

```bash
# 典型路径
/var/log/nginx/access.log
/var/log/nginx/error.log
/var/log/postgresql/postgresql-15-main.log
/var/log/redis/redis-server.log
~/app/logs/2026-05-25.log
```

**怎么找**？

```bash
# 方法 1：看进程打开了哪些文件
$ sudo lsof -p $(pidof nginx | awk '{print $1}') | grep log

# 方法 2：看应用配置
$ cat /etc/nginx/nginx.conf | grep -i log

# 方法 3：去 /var/log 翻
$ sudo find /var/log -type f -name '*.log' | head
```

### `tail -f` + 几个进阶

```bash
$ tail -f /var/log/nginx/access.log

# 多文件同时跟
$ tail -f /var/log/nginx/{access,error}.log
$ tail -f /var/log/{nginx,redis}/*.log

# 跟着文件 rotate（推荐！tail 默认 rotate 后跟错）
$ tail -F /var/log/nginx/access.log     # -F 大写：跟踪文件名，rotate 后切到新的

# 只看新产生的，含正则
$ tail -F /var/log/nginx/error.log | grep --line-buffered -E '500|502|timeout'
```

`--line-buffered` 让 grep 在管道里**也按行刷新**——否则会卡 4KB 缓冲。

### `multitail`：多文件并排

```bash
$ sudo apt install multitail
$ multitail -i /var/log/nginx/access.log -i /var/log/nginx/error.log
```

多窗口排版，加颜色。比 tmux 分屏轻量。

### `lnav`：日志浏览器（强烈推荐）

```bash
$ sudo apt install lnav

$ lnav /var/log/syslog
```

lnav 自动识别 nginx / apache / syslog / json 等几十种格式，提供：

- 时间轴 + 状态码热度图
- 语法高亮
- SQL 查询模式：`;SELECT log_msg FROM access_log WHERE sc_status >= 500`
- 实时跟踪 + 过滤

学会 lnav，日志分析效率翻倍。

---

## 4. `logrotate`：防止日志撑爆磁盘

**雪崩第二大杀手**（第一是内存 OOM）就是日志不轮转——一两个月磁盘塞满，应用写不动崩溃。

### 看现有规则

```bash
$ ls /etc/logrotate.d/
nginx  postgresql-common  rsyslog  apt  cron  ...

$ cat /etc/logrotate.d/nginx
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        if [ -f /var/run/nginx.pid ]; then
            kill -USR1 `cat /var/run/nginx.pid`
        fi
    endscript
}
```

读法：

| 字段 | 含义 |
|---|---|
| `daily` | 每天 rotate（也可 `weekly` / `monthly` / `size 100M`） |
| `rotate 14` | 保留 14 份历史 |
| `compress` | 旧的压缩成 .gz |
| `delaycompress` | 上一份**不压**，再前面才压（防止应用还在写新文件名时被压） |
| `create 0640 user grp` | 新文件用什么权限 |
| `postrotate ... endscript` | rotate 后跑的 shell（**典型：发 SIGUSR1 让应用重开 fd**） |
| `notifempty` | 空文件不 rotate |
| `missingok` | 文件不存在也不报错 |

### 给自己应用加一份 logrotate 配置

新建 `/etc/logrotate.d/myapp`：

```
/var/log/myapp/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0644 myapp myapp
    postrotate
        systemctl reload myapp.service > /dev/null 2>&1 || true
    endscript
}
```

每天 rotate 一次，保留 7 份，rotate 后通知应用 reopen 文件。

### 立刻测一遍（不等明天）

```bash
$ sudo logrotate -d /etc/logrotate.d/myapp    # -d debug 干跑
$ sudo logrotate -f /etc/logrotate.d/myapp    # -f force 立刻执行
```

### `postrotate` 必须做的事

应用持有 log 文件的 fd 不放——logrotate `mv` 旧文件后，**应用还在写已被改名的文件**，新 access.log 还是空的。

**解决方案 3 选 1**：

1. **发 SIGUSR1**（nginx / apache / haproxy 模式）：触发应用重新 open
2. **systemctl reload**：让 systemd 帮你（适合现代应用）
3. **copytruncate**：logrotate 复制完旧文件**清空原文件**（不改 inode），应用不察觉

```
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    copytruncate          # ← 不用通知应用
}
```

但 `copytruncate` 有**短暂窗口**会丢日志（cp 期间的 write）——能用 SIGUSR1 还是优先 SIGUSR1。

---

## 5. journald 怎么不爆

`/var/log/journal/` 不轮转的话也会涨。journald 自己管：

```bash
# 看当前占多少
$ journalctl --disk-usage
Archived and active journals take up 4.5G in the file system.

# 限制大小
$ sudo journalctl --vacuum-size=500M

# 限制时间
$ sudo journalctl --vacuum-time=14d
```

或者改配置 `/etc/systemd/journald.conf`：

```ini
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
MaxRetentionSec=2week
ForwardToSyslog=no             # 不转发给 syslog 节省 IO
```

改完：

```bash
$ sudo systemctl restart systemd-journald
```

---

## 6. 集中日志（生产建议）

单机看日志的极限——几台还行，几十台就废。生产环境**一定要集中化**。

3 种主流方案：

### A. ELK / Elastic Stack

```
应用 → filebeat → logstash → Elasticsearch → Kibana
```

老牌，功能强，**资源吃得多**（ES 至少 4G 内存起）。

### B. Loki + Grafana（推荐中小规模）

```
应用 → promtail / vector → Loki → Grafana
```

Loki 像 "Prometheus for logs"，**只 index 标签不 index 内容**——便宜很多。

### C. 云厂商托管

阿里云 SLS、AWS CloudWatch Logs、GCP Cloud Logging。**省事但贵 + lock-in**。

中小规模（< 10 台机器、< 100GB 日志/天）→ **Loki + Grafana** 是甜点。

---

## 7. 日志分析常见 1 行

```bash
# nginx access log 出现最多的 IP
$ awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head

# 状态码分布
$ awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn

# 慢请求（假设第 10 列是 ms）
$ awk '$10 > 1000 {print $7, $10}' /var/log/nginx/access.log | sort -k2 -rn | head

# auth.log 暴力破解尝试
$ grep 'Failed password' /var/log/auth.log \
    | awk '{print $11}' | sort | uniq -c | sort -rn | head

# journald 里 systemd 失败的服务
$ journalctl -p err -u systemd | tail -30

# 找内核 OOM kill
$ dmesg -T | grep -E 'oom-killer|killed process'
```

参考 [07 text-pipes](text-pipes) 那一篇组合大法。

---

## 8. 排查清单：应用挂了，5 分钟内定位

```bash
# 1. 服务跑没跑
$ systemctl status myapp.service

# 2. systemd 自己的视角
$ journalctl -u myapp.service -n 50 --no-pager

# 3. 应用自己的日志
$ ls -lhrt /var/log/myapp/      # 最新的在最下
$ tail -100 /var/log/myapp/error.log

# 4. 内核 / 硬件视角
$ dmesg -T | tail -50
$ journalctl -k --since '10 min ago'

# 5. 跟应用相关的最近所有日志
$ journalctl --since '30 min ago' | grep -i myapp

# 6. 是不是磁盘满 / inode 满
$ df -h
$ df -i

# 7. 是不是被 OOM 杀
$ dmesg -T | grep -iE 'killed process'
```

按这条清单走 → **95% 的"挂了"都能 5 分钟定位**。

---

## 9. 现在做一件事

```bash
# 1. 看你系统现在日志总占用
$ sudo du -sh /var/log
$ journalctl --disk-usage

# 2. 找过去 24 小时的所有错误
$ journalctl -p err --since '24 hours ago' | tail -50

# 3. 看你机器有哪些 logrotate 规则
$ ls /etc/logrotate.d/

# 4. 测试 logrotate 配置不会跑挂
$ sudo logrotate -d /etc/logrotate.conf 2>&1 | head -30

# 5. 装个 lnav，体验下现代日志浏览器
$ sudo apt install lnav
$ lnav /var/log/syslog
```

日志能力是**事后复盘**的基本功——比看监控指标更细。

---

> **下一篇**：[kernel-tuning](kernel-tuning)——`/proc/sys / sysctl / cgroup` 怎么调内核行为，常见 net / vm / fs 参数，让一个 1G 小机器的并发上限翻几倍。
