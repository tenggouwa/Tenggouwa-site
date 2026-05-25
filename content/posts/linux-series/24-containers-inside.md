---
slug: containers-inside
title: 容器到底是什么：namespace + cgroup + overlayfs + capabilities
summary: Linux 系列第 24 篇。"容器是轻量级虚拟机"——这个口语描述其实误导。容器跟 VM 完全是两种东西：它就是宿主机上的一个普通进程，只是被关进了几个 namespace + cgroup 笼子。这一篇拆 Docker / containerd 背后的 4 块拼图，让你彻底理解为什么容器秒级启动、为什么"容器逃逸"是大事件。
tags: [linux, linux-series, container, docker, namespace, cgroup]
published_at: 2026-07-07
---

> 这是 Linux 系列的第 24 篇——**容器与部署章节**的第一篇。前面所有铺垫——进程、文件系统、网络、cgroup——都是为了这一篇能讲清楚。

## 0. 容器不是"轻量 VM"

最大的误解就是把容器想象成"小型虚拟机"。

```
┌──────────────────────────┐    ┌──────────────────────────┐
│  虚拟机 (VM)               │    │  容器 (Container)         │
│ ┌────────────────────────┐│    │ ┌────────────────────────┐│
│ │ 应用                    ││    │ │ 应用                    ││
│ │ libs                   ││    │ │ libs                   ││
│ │ 完整 Guest OS（含内核）  ││    │ │ （没有自己的内核）       ││
│ └────────────────────────┘│    │ └────────────────────────┘│
│        ↑                  │    │        ↑                  │
│   Hypervisor (KVM/Xen)    │    │   Container Runtime       │
│        ↑                  │    │        ↑                  │
│    宿主机内核               │    │    宿主机内核 ← 共享！      │
└──────────────────────────┘    └──────────────────────────┘
```

容器**没有自己的内核**——所有容器**共用宿主机的 Linux 内核**。容器只是一个**被关到笼子里的普通进程**。

这就是为什么：

- 容器**秒级启动**（只是 fork+exec）；VM 几十秒（要起完整内核）
- 容器**密度高**（一台机器跑几百个）；VM 几十个就到顶
- 容器**逃逸危险**（一旦从笼子里跑出来直接是宿主机 root）；VM 隔离强（要先黑掉 hypervisor）

那这个"笼子"由什么组成？4 块拼图：

```
namespace（看什么）+ cgroup（用多少）+ overlayfs（站哪里）+ capabilities（能做什么）
                              ↓
                            容器
```

下面一块一块拆。

---

## 1. namespace：让进程"看到"什么

Linux namespace 是给进程"换个世界观"的内核机制——同一台机器上，**不同 namespace 的进程看到的资源是隔离的**。

有 8 种 namespace：

| Namespace | 隔离什么 |
|---|---|
| **PID** | 进程号——容器里的 PID 1 实际是宿主机 PID 12345 |
| **NET** | 网卡 / 路由 / iptables / 端口 —— 容器有自己的 lo / eth0 |
| **MNT** | 挂载点 / 文件系统视图 |
| **UTS** | hostname / domain name |
| **IPC** | System V IPC / POSIX 消息队列 / 共享内存 |
| **USER** | uid / gid 映射（容器里的 root 可以不是宿主机 root） |
| **CGROUP** | cgroup 视图 |
| **TIME** | （5.6+）时钟偏移 |

### 实测看一眼

```bash
$ docker run -it --rm alpine sh
/ # echo $$
1                          # 我是 PID 1
/ # hostname
9f2d4e8c1234               # 容器自己的 hostname
/ # ip addr
1: lo: ...
2: eth0@if89: ...          # 容器自己的网卡
/ # ps aux
PID   USER     TIME  COMMAND
    1 root      0:00 sh
    5 root      0:00 ps aux
                           # 只看得到自己 + ps
```

在另一个终端从宿主机看：

```bash
$ ps -ef | grep alpine
root  12345  12340  0 ...  /bin/sh   # 容器里的 PID 1 在宿主机是 PID 12345
$ ls /proc/12345/ns/
cgroup   ipc   mnt   net   pid   pid_for_children   user   uts
                                                    ↑
                                                    每个文件对应一个 namespace
```

容器的进程在内核里跟普通进程**没区别**——只是它的 `/proc/<pid>/ns/` 里指向的 namespace 跟宿主机其他进程不一样。

### `nsenter` 进入别的容器的 namespace（救场神器）

```bash
$ docker inspect <container> | grep Pid
"Pid": 12345

$ sudo nsenter -t 12345 -n -p ip addr    # 用宿主机的命令进容器的 net+pid namespace
```

这就是为什么 `docker exec` 能秒进容器——它本质就是 `nsenter` + 启一个 shell。

---

## 2. cgroup：限制"用多少"

[23 kernel-tuning](kernel-tuning) 已经讲过 cgroup。容器层就是把它**封装成 API**：

```bash
# 看 docker 容器的 cgroup 限制
$ docker run -d --name test --memory=256M --cpus=0.5 alpine sleep 999
$ docker inspect test | grep -i 'memory\|cpu' | head

$ cat /sys/fs/cgroup/system.slice/docker-*.scope/memory.max
268435456                  # 256MB
$ cat /sys/fs/cgroup/system.slice/docker-*.scope/cpu.max
50000 100000               # 每 100ms 给 50ms
```

容器进程**还是普通进程**——只是 cgroup 告诉内核"这个进程的内存别超 256MB / CPU 别超 50%"。

OOM kill 内部也是按 cgroup 的限制触发：

```
进程内存超 cgroup.memory.max → cgroup 内 OOM kill（不影响 cgroup 外的进程）
```

这就是为什么"杀容器进程不会拖垮宿主机"——隔离在内核 cgroup 层做了。

---

## 3. overlayfs：站在"虚拟文件系统"上

容器有自己的根文件系统（`/`、`/etc`、`/usr` 等），这一份从哪来？答案：**镜像分层 + 联合挂载**。

```
镜像层（read-only）：
  base layer:    ubuntu rootfs（200MB）
  layer 1:        apt install nginx
  layer 2:        COPY nginx.conf /etc/nginx/

容器运行时层：
  rw-layer:       容器写的东西在这里（只在容器活的时候）

实际看到的根 /：
  = overlayfs.merge(base, layer1, layer2, rw-layer)
```

overlayfs 把多层 read-only 镜像 + 一层 read-write **联合起来**，让进程看到的就是一个"完整可读写"的文件系统。

```bash
# 看 docker 的 overlayfs
$ mount | grep overlay
overlay on /var/lib/docker/overlay2/abc123/merged type overlay (rw,...,lowerdir=...,upperdir=...,workdir=...)
```

字段：

- `lowerdir`：镜像各层（read-only，多个用 : 分隔）
- `upperdir`：容器写的层（read-write）
- `workdir`：overlayfs 内部用
- `merged`：进程看到的统一视图

**写文件的语义**（Copy-on-Write）：

```
容器进程写 /etc/nginx/conf
  ↓ overlayfs 拦截
镜像层里有这个文件吗？
  有 → 从镜像层 copy 一份到 upper layer，再写 upper（镜像层不变）
  没 → 直接写 upper

读文件：
  upper 有 → 用 upper 的
  upper 没 → 找下层（镜像层），用第一个找到的
```

**好处**：

- 镜像层不变 → 100 个容器都跑同一个 nginx 镜像，磁盘只占 1 份
- 容器写的东西在自己 upper layer → 容器死掉自动清

**这就是 Docker 镜像层级 + Dockerfile 每条指令一层的根本原理**。

---

## 4. capabilities：root 权限的"细分"

传统 Unix 只有"普通用户 vs root"——root 能做一切。这太粗。Linux 把 root 权限**切成 38 块**叫 capabilities：

| Capability | 干什么 |
|---|---|
| `CAP_NET_BIND_SERVICE` | 绑定 1024 以下端口（如 80） |
| `CAP_NET_ADMIN` | 改网络配置（iptables, ip route）|
| `CAP_SYS_ADMIN` | 几十种系统操作（最危险，叫"new root"）|
| `CAP_SYS_PTRACE` | ptrace 别的进程（gdb / strace 需要）|
| `CAP_DAC_OVERRIDE` | 跳过文件权限检查 |
| `CAP_CHOWN` | chown |
| `CAP_KILL` | 给任意进程发信号 |
| ... | 还有几十个 |

容器默认**只给少数 capability**，大幅缩小攻击面：

```bash
$ docker run --rm alpine grep CapBnd /proc/self/status
CapBnd:  00000000a80425fb        # 默认有这些（少于完整 root）

$ docker run --rm --privileged alpine grep CapBnd /proc/self/status
CapBnd:  000001ffffffffff        # --privileged 给所有 capability（"伪 root"）
```

**最佳实践**：

```bash
# 给最小权限（推荐）
$ docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE nginx

# Kubernetes:
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["NET_BIND_SERVICE"]
```

**`--privileged` 等于把容器跟宿主机的隔离彻底关掉**——只在你确实需要操作硬件 / 内核（如调试容器）时用。

---

## 5. 把 4 块拼起来：从零造一个"手工容器"

光懂概念不够，亲手做一个：

```bash
# 1. 准备一个最小 rootfs
$ mkdir mycontainer && cd mycontainer
$ docker export $(docker create busybox) | tar -xf -

# 2. 用 unshare 起一个新进程到新的 PID/NET/MNT namespace
$ sudo unshare --mount --uts --ipc --net --pid --fork --user --map-root-user \
    chroot . /bin/sh

# 进去后看：
/ # ps                   # 只看到自己（PID namespace 生效）
PID  USER     COMMAND
1    root     /bin/sh
2    root     ps

/ # hostname             # 默认是 nodename，但你能改不影响宿主
/ # ip addr              # 空（没网卡，因为新建的 net ns 还没挂网卡）
```

这就是一个"裸容器"。Docker 在此基础上又：

- 配 overlayfs 让根目录是镜像层
- 配 cgroup 限制资源
- 配 veth 让容器有网卡
- 起一堆 hook（runtime spec）

**核心理解**：Docker 没什么魔法——它是 Linux 这堆**1990s-2010s 陆续加进来的内核功能**的优秀产品化。

---

## 6. Docker 软件栈一句话

```
你的命令 docker run
   ↓
docker (CLI)
   ↓ HTTP
dockerd (daemon)
   ↓ gRPC
containerd
   ↓
runc        ← 真正的"启容器"工具，调 unshare + execve + cgroup
   ↓
你的容器进程
```

现代 Kubernetes 直接调 containerd，跳过 docker：

```
kubelet → CRI（接口）→ containerd → runc → 容器
```

**docker 这个 CLI 还在用是因为开发者用得习惯**——生产环境的 K8s 已经不依赖 docker 多年。

---

## 7. 几个常见"为什么"被解释

### A. 为什么容器逃逸是大事件

容器跟宿主机**共享内核**。一旦容器进程：

- 拿到 `CAP_SYS_ADMIN` 或 `--privileged`
- 内核有漏洞（如脏牛 / Spectre）
- 挂了 `/var/run/docker.sock`（能控制 docker daemon）

→ 它在宿主机上是 root。**这跟 VM 逃逸完全两个量级的难度**——VM 要先黑 hypervisor。

> 这就是为什么 K8s 安全里反复强调 "Pod Security Standards"、"capabilities drop"、"runAsNonRoot"——容器的隔离不像 VM 那么坚固。

### B. 为什么 Docker on Mac 那么慢

macOS **没有 Linux 内核**——所以 Docker for Mac **里面跑了一个轻量 Linux VM**（HyperKit / Apple Virtualization Framework）。

```
Mac App "Docker Desktop"
  └─ Linux VM
      └─ dockerd / containerd
          └─ 容器
```

文件挂载从 Mac 到 VM 走 9P 协议（极慢）。**macOS 用户做开发要不就 OrbStack 替代 Docker Desktop**，要不就直接在云上跑容器。

### C. 容器为什么瞬间启动

```
docker run ubuntu echo hi
  ↓
1. 拉镜像（已经有就跳过）
2. fork + 配置 namespace + cgroup
3. overlayfs 准备根目录
4. execve("echo", ...)
5. 输出 "hi"

→ 全部 < 100ms
```

对比 VM：

```
VM 启动
  ↓
1. 分配虚拟硬件
2. BIOS / UEFI
3. bootloader 加载 kernel
4. kernel 初始化（设备探测、文件系统挂载……）
5. systemd 起所有服务
6. 终于跑你的程序

→ 几十秒
```

容器跳过整个内核启动——直接从 fork 开始。这就是为什么"容器实现 serverless / 函数计算"成立。

---

## 8. 安全实践速记（生产部署容器必看）

```yaml
# Dockerfile 起手式
FROM alpine:3.20            # 用小镜像
RUN addgroup -S app && adduser -S -G app app   # 建非 root 用户
USER app                    # 切到非 root
WORKDIR /app
COPY --chown=app:app . .
CMD ["./my-binary"]
```

```bash
# docker run 起手式
docker run \
    --rm \
    --read-only \
    --tmpfs /tmp \
    --cap-drop=ALL \
    --cap-add=NET_BIND_SERVICE \
    --no-new-privileges \
    --security-opt=no-new-privileges \
    --memory=512M \
    --cpus=0.5 \
    --pids-limit=100 \
    -u 1000:1000 \
    nginx
```

K8s 里把这些翻译成 securityContext。

---

## 9. `docker` 命令速查（很多人不知道的）

```bash
# 看容器进程实际在宿主机的 PID
$ docker top <container>
$ docker inspect <container> -f '{{.State.Pid}}'

# 看容器 namespace
$ docker inspect <container> -f '{{.NetworkSettings.SandboxKey}}'
# 用 nsenter -t <pid> -n 进去

# 看 cgroup 路径
$ docker inspect <container> -f '{{.HostConfig.CgroupParent}}'

# 看 layered overlayfs 路径
$ docker inspect <container> -f '{{json .GraphDriver}}' | jq

# 实时 stats
$ docker stats --no-stream

# 看镜像每层多大
$ docker history <image>

# 进容器（exec 干净退出）
$ docker exec -it <container> sh

# 强制重建（不用缓存）
$ docker build --no-cache -t my .

# 找谁占了磁盘
$ docker system df
$ docker system prune -a    # 清理未用的（小心）
```

---

## 10. 现在做一件事

```bash
# 1. 跑一个最简单的容器，看它的 namespace
$ docker run -d --name test alpine sleep 999
$ PID=$(docker inspect test -f '{{.State.Pid}}')
$ sudo ls -l /proc/$PID/ns/

# 2. 看容器的 cgroup
$ sudo cat /sys/fs/cgroup/system.slice/docker-*.scope/memory.max 2>/dev/null | head

# 3. 用 nsenter 进去（不用 docker exec）
$ sudo nsenter -t $PID -n -p ip addr        # 看容器视角的网络
$ sudo nsenter -t $PID -m ls /              # 看容器视角的根目录

# 4. 看容器有哪些 capability
$ docker exec test grep CapBnd /proc/self/status

# 5. 看 docker overlayfs 长什么样
$ docker inspect test -f '{{.GraphDriver.Data.MergedDir}}'
$ sudo ls $(docker inspect test -f '{{.GraphDriver.Data.MergedDir}}')

# 清理
$ docker rm -f test
```

理解了容器**不是黑魔法**，你看 K8s / Docker / containerd / Podman 任何一个都顺手——它们都是同一组内核积木的不同摆法。

---

> **下一篇**（**Linux 系列终篇**）：[vps-bootstrap](vps-bootstrap)——5 分钟把一台空 VPS 调到"能放心跑业务"的清单。本系列所有内容的实战收官。
