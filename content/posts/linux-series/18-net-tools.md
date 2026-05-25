---
slug: net-tools
title: 现代 Linux 网络工具集：ip / ss / dig / curl / nc
summary: Linux 系列第 18 篇。`ifconfig` / `netstat` / `route` / `nslookup` 这套上世纪的工具今天还能用，但已经被 `ip` / `ss` / `dig` 替代。这一篇拆 5 件现代工具的常用语法，并给一份"网络出问题怎么 5 分钟排查到根因"的清单。
tags: [linux, linux-series, network, ip, ss, dig, curl]
published_at: 2026-07-01
---

> 这是 Linux 系列的第 18 篇，进入**网络章节**。前面讲了进程怎么跑——这一篇讲它们怎么"上网"。

## 0. 旧工具 vs 新工具

如果你看过老教程，可能见过：

```
ifconfig   netstat   route   nslookup   arp
```

这些被 net-tools 包提供，**新发行版（CentOS 7+, Ubuntu 20+, Debian 11+）默认不装**。取代它们的是 iproute2 + bind-utils：

| 老 | 新 | 现代发行版默认 |
|---|---|---|
| `ifconfig` | `ip addr` / `ip link` | ✓ 装 ip |
| `netstat -tnp` | `ss -tnp` | ✓ 装 ss |
| `route -n` | `ip route` | ✓ |
| `arp -n` | `ip neigh` | ✓ |
| `nslookup` | `dig` / `host` | dig 是标准 |
| `traceroute` | `mtr` / `tracepath` | 同时存在 |

**新工具**：**功能更全 + 输出更结构化 + 性能更好**（ss 比 netstat 在大连接量时快 10x+）。这一篇全用新工具讲。

---

## 1. `ip`：看 / 改网卡 + IP + 路由

```bash
# 看所有网卡
$ ip addr
1: lo: <LOOPBACK,UP> mtu 65536 ...
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,UP> mtu 1500 ...
    link/ether 52:54:00:12:34:56
    inet 10.0.0.10/24 scope global eth0
    inet6 fe80::5054:ff:fe12:3456/64 scope link

# 简化
$ ip -br addr           # brief
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0             UP             10.0.0.10/24 fe80::.../64

$ ip -br link            # 物理网卡状态
$ ip -c -br addr         # 加颜色
```

记忆：`-br` (brief) + `-c` (color)，写进 alias：

```bash
alias ip='ip -c'
```

### 看路由

```bash
$ ip route
default via 10.0.0.1 dev eth0 proto dhcp src 10.0.0.10 metric 100
10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.10
169.254.169.254 via 10.0.0.1 dev eth0 proto dhcp     # 云厂商 metadata
```

读法：

- `default via X.X.X.X dev Y` = 默认网关（所有不匹配特定路由的流量走它）
- `10.0.0.0/24 dev eth0` = 这个网段直连（同子网）
- `169.254.169.254` = AWS / 阿里云的元数据服务

```bash
# 查到某 IP 走哪条路由
$ ip route get 8.8.8.8
8.8.8.8 via 10.0.0.1 dev eth0 src 10.0.0.10 uid 1000
    cache
```

### 看 ARP 表（"邻居"）

```bash
$ ip neigh
10.0.0.1   dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
10.0.0.99  dev eth0 lladdr 11:22:33:44:55:66 STALE
```

ARP 把 IP 翻译成 MAC——同子网通信的基础。

### 临时改 IP（重启失效）

```bash
$ sudo ip addr add 10.0.0.99/24 dev eth0
$ sudo ip addr del 10.0.0.99/24 dev eth0
$ sudo ip link set eth0 up
$ sudo ip link set eth0 down
$ sudo ip route add 192.168.1.0/24 via 10.0.0.1
```

永久改要写 `/etc/network/interfaces`（Debian）或 `/etc/netplan/`（Ubuntu）或 `/etc/sysconfig/network-scripts/`（RHEL）—— 不同发行版差异大，遇到再查。

---

## 2. `ss`：看 socket / 端口监听

`ss` 是 "socket statistics" 缩写，**netstat 的替代品**。

### 最高频 3 条

```bash
# 看所有 TCP 监听端口（"什么服务在等连接"）
$ ss -tlnp
State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process
LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:(("sshd",pid=890,fd=3))
LISTEN  0       128     127.0.0.1:6379       0.0.0.0:*          users:(("redis-server",pid=1234,fd=6))
LISTEN  0       511     0.0.0.0:80           0.0.0.0:*          users:(("nginx",pid=891,fd=6))

# 看所有活跃 TCP 连接
$ ss -tnp

# UDP
$ ss -ulnp

# 全部（TCP + UDP）
$ ss -anp
```

flag 速记：

```
-t  TCP
-u  UDP
-l  listening（监听中）
-n  数字（不解析端口名）
-p  显示进程
-a  all（含 listen 和 established）
```

### "端口被谁占了"

```bash
# 找 8080 端口的占用者
$ sudo ss -lntp 'sport = :8080'
LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("python",pid=5678,fd=3))

# 等价的 lsof 写法
$ sudo lsof -i :8080
```

### 当前 TCP 连接状态统计

```bash
$ ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c | sort -rn
    234 ESTAB
     12 TIME-WAIT
      8 LISTEN
      3 CLOSE-WAIT
```

`TIME-WAIT` 多 = 你的服务正在关闭大量短连接（正常）。
`CLOSE-WAIT` 多 = **你的代码没正确 close socket**（bug 信号）。

### 看连接的具体握手状态

```bash
$ ss -tani 'state established'
```

`-i` 加显示 cwnd / rtt 等 socket 内部状态，调网络性能时用。

---

## 3. `dig`：DNS 查询

```bash
# 最基本
$ dig example.com
;; ANSWER SECTION:
example.com.    300   IN    A     93.184.216.34

# 只要答案，不要废话
$ dig +short example.com
93.184.216.34

# 各类查询
$ dig +short example.com A          # IPv4
$ dig +short example.com AAAA       # IPv6
$ dig +short example.com MX         # 邮件服务器
$ dig +short example.com NS         # 哪台 DNS 在管这个域
$ dig +short example.com TXT        # TXT 记录（SPF / DKIM / google-verification）
$ dig +short example.com CNAME      # 别名

# 反向查 IP
$ dig +short -x 8.8.8.8
dns.google.

# 指定 DNS 服务器（不走系统默认）
$ dig @8.8.8.8 example.com
$ dig @1.1.1.1 example.com
$ dig @114.114.114.114 example.com    # 国内：114
```

### 调试 DNS 时最有用的两条

```bash
# 看完整解析链路（从根域开始一级一级问）
$ dig +trace example.com

# 看你机器实际查的 DNS server 是谁
$ cat /etc/resolv.conf
# 或者
$ systemd-resolve --status              # systemd-resolved 系统
$ resolvectl status                      # 同上，新版命令
```

DNS 故障常见原因（按概率排序）：

1. `/etc/resolv.conf` 写错了 DNS server（被 DHCP 改过）
2. 防火墙拦了 udp/53 出站
3. `/etc/hosts` 里有冲突条目（短路把域名指错）
4. DNS over TLS / DoH 配错

### 几个常用域名快测

```bash
# 你能解析吗？
$ dig +short google.com 8.8.8.8 baidu.com

# 谁是这个 IP 的反向解析
$ dig +short -x $(curl -s ifconfig.me)
```

---

## 4. `curl`：HTTP 瑞士军刀

```bash
# 基本 GET
$ curl https://example.com

# 看响应头（不下正文）
$ curl -I https://example.com

# 完整看请求 + 响应
$ curl -v https://example.com

# POST JSON
$ curl -X POST https://api.example.com/users \
    -H 'Content-Type: application/json' \
    -d '{"name":"alice"}'

# 上传文件
$ curl -F 'file=@/path/to/photo.jpg' https://api.example.com/upload

# 跟随重定向
$ curl -L https://example.com

# 下载到文件
$ curl -O https://example.com/file.tar.gz     # 用远端文件名
$ curl -o local.tgz https://example.com/file.tar.gz

# 加超时和重试（生产脚本必备）
$ curl --max-time 10 --retry 3 https://example.com

# 静默 + 只要 HTTP 状态码（健康检查脚本用）
$ curl -s -o /dev/null -w '%{http_code}\n' https://example.com
200
```

### 当 HTTP 客户端调试用

```bash
# 看 TLS 握手 + 证书细节
$ curl -v https://example.com 2>&1 | grep -E '(SSL|TLS|subject:|issuer:)'

# 测一下到某个 IP 的访问（绕过 DNS，验证 nginx 配置）
$ curl --resolve example.com:443:1.2.3.4 https://example.com

# 看每一阶段耗时（DNS / TCP / TLS / TTFB / total）
$ curl -w '\n
   dns:        %{time_namelookup}s
   tcp_connect: %{time_connect}s
   tls:         %{time_appconnect}s
   ttfb:        %{time_starttransfer}s
   total:       %{time_total}s
\n' -o /dev/null -s https://example.com
```

最后那个**性能拆解模板**值得收藏——5 秒看清"是 DNS 慢、TLS 慢、还是后端慢"。

---

## 5. `nc`（netcat）：网络的瑞士军刀

`nc` 能扮演**任意 TCP/UDP client / server**，调试神器。

### 测连通（**比 telnet 现代**）

```bash
# 测某端口能不能连
$ nc -zv example.com 443
Connection to example.com 443 port [tcp/https] succeeded!

$ nc -zv 10.0.0.5 6379
nc: connect to 10.0.0.5 port 6379 (tcp) failed: Connection refused
```

`-z` 是"只看通不通，不传数据"，`-v` 是 verbose。

### 起一个临时 TCP server

```bash
# 起一个监听 8080
$ nc -l 8080
（接受连接，把对方发的内容打到屏幕，把屏幕输入发给对方）

# 测试用法：另一边
$ echo "hello" | nc localhost 8080
```

### 给传文件用

```bash
# 接收端
$ nc -l 9999 > received.tar.gz

# 发送端
$ nc <receiver-ip> 9999 < big.tar.gz
```

简单粗暴，不加密。适合内网快传。

### 端口扫描（小范围；大规模用 nmap）

```bash
$ nc -zv example.com 80 443 22 6379 5432 2>&1 | grep -E "succeeded|refused"
```

> **注意**：现代 Linux 上的 `nc` 有 `openbsd-netcat` 和 `gnu-netcat` 两个版本，参数略不同。`-N` 在 openbsd 是"读完就关"，在 gnu 是"不解析 DNS"。看不懂参数 → `man nc`。

---

## 6. `mtr` / `traceroute` / `ping`：连通性 + 路径

```bash
# 看到目标走了哪几跳
$ traceroute example.com
 1  router (10.0.0.1)        1.2 ms
 2  isp-gateway (1.2.3.4)    8.5 ms
 3  *  *  *
 4  some-backbone (...)      15 ms
 ...

# mtr = traceroute + ping 实时刷新版（更好用）
$ mtr example.com
```

mtr 持续测每一跳的丢包率 + RTT，**排查"我到某 IP 慢"最好的工具**。

### ping 的常用 flag

```bash
$ ping -c 5 example.com        # 只发 5 个就停
$ ping -i 0.2 example.com      # 间隔 0.2 秒
$ ping -W 1 example.com        # 超时 1 秒
$ ping -s 1500 example.com     # 大包测 MTU
$ ping -f example.com          # flood（要 root；测网络极限）
```

---

## 7. 排查清单：网络出问题的 5 分钟流程

按以下顺序逐项排查：

```bash
# 1. 本地网卡正常吗
$ ip -br addr
$ ip -br link

# 2. 路由 OK 吗
$ ip route
$ ip route get 8.8.8.8

# 3. DNS 通吗
$ dig +short google.com
$ dig +short google.com @8.8.8.8

# 4. ICMP 能通吗（防火墙可能拦）
$ ping -c 3 -W 2 8.8.8.8
$ ping -c 3 -W 2 google.com

# 5. 目标端口能连吗
$ nc -zv target.example.com 443

# 6. HTTP 真正能响应吗
$ curl -I --max-time 5 https://target.example.com

# 7. 路径上哪一跳在丢包
$ mtr --report --report-cycles 30 target.example.com
```

按这个顺序——大部分网络故障 5 分钟内能定位到："是 DNS 问题 / 路由问题 / 防火墙问题 / 还是对端服务问题"。

---

## 8. `tcpdump`：抓包

更深入的调试需要抓包：

```bash
# 抓 eth0 上所有 TCP
$ sudo tcpdump -i eth0 tcp

# 只看某端口
$ sudo tcpdump -i any port 80

# 只看到 / 来自某 IP
$ sudo tcpdump -i any host 1.2.3.4
$ sudo tcpdump -i any src 1.2.3.4
$ sudo tcpdump -i any dst 1.2.3.4

# 写到文件给 Wireshark 看
$ sudo tcpdump -i any -w capture.pcap port 80
$ sudo tcpdump -i any -w capture.pcap -c 1000      # 抓 1000 包就停

# 解析 HTTP 包体（小心隐私）
$ sudo tcpdump -i any -A 'port 80 and tcp'
```

tcpdump 配 Wireshark 是网络调试天花板。但 99% 场景 nc + curl + ss 已经够。

---

## 9. 看自己 IP / 公网出口 IP

```bash
# 自己的网卡 IP（内网）
$ ip -br addr | grep -v '^lo' | awk '{print $3}'

# 公网出口 IP（"我在别人眼里是哪个 IP"）
$ curl -s ifconfig.me; echo
$ curl -s https://api.ipify.org; echo
$ curl -s -4 https://icanhazip.com    # IPv4
$ curl -s -6 https://icanhazip.com    # IPv6（如果有的话）
```

---

## 10. 现在做一件事

```bash
# 1. 看你机器现在所有监听端口
$ ss -tlnp

# 2. 测你的 DNS 解析
$ dig +short google.com baidu.com tenggouwa.com

# 3. 看你机器现在公网 IP
$ curl -s ifconfig.me; echo

# 4. 测到 1.1.1.1 的路径
$ mtr --report -c 10 1.1.1.1 2>&1 | head -15

# 5. 看你某个常用服务的连接性能
$ curl -w 'dns=%{time_namelookup}s tcp=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s\n' \
    -o /dev/null -s https://google.com
```

这 5 个命令是网络运维 80% 的日常——熟练后基本不需要查任何 GUI。

---

> **下一篇**：[firewall-stack](firewall-stack)——`iptables / nftables / ufw` 在 Linux 防火墙里到底什么关系，几层 NAT 怎么穿、为啥 Docker 加了一堆规则你看着头大。
