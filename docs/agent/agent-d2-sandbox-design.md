# D2 · Shell 工具与沙箱方案（可执行设计）

> 状态：设计定稿，待排期实现。本文 refine 并**取代** [agent-roadmap.md](./agent-roadmap.md) §D0 里
> 「FC AIO Sandbox + Redis 句柄」那版设想 —— 那版基于两个和现状不符的假设（详见 §7）。

## 0. 一句话结论

**prod 小机永远不执行任意命令。** agent 的 shell 命令经**现有的 terminal broker**（服务器零入站、
全走 daemon 主动 outbound WSS）转发到一台**你指定的、可丢弃的沙箱 daemon 机**执行；daemon 侧用
**bubblewrap** 把每条命令关进 namespace 沙箱。授权链**完全复用**刚做完的 TOTP 私有通道 + C2 审批。

要新写的只有三小块：broker 的一发一收 RPC、daemon 的非交互 exec handler、`shell_exec` skill。
其余（WSS 传输、agent token 鉴权、上线状态、私有通道、逐条审批、输出截断）全部现成。

## 1. 为什么是这个方案（结合现状）

### 现状盘点（已上线、可复用）
- **`apps/mac-agent`**：一个 daemon，从你的机器**主动 outbound WSS** 到 `wss://api.tenggouwa.com/api/agent/ws`，
  按 `ptyprocess` spawn 一个 PTY 跑 `$SHELL -l`，双向转发字节。**服务器没有任何入站连接。**
- **`terminal/broker.py`**：内存 broker，把一个 client 和一个 agent 配对、转发字节/控制帧（`{t: ...}` JSON）。
- **`terminal` 鉴权**：admin 在后台「新建 agent」拿一次性 token → daemon 用 `Authorization: Bearer <agent_token>`
  接入 `/api/agent/ws`；token 存 sha256、可撤销。
- **私有通道 + C2 审批**（本轮 #145–#154）：`shell_exec` 标 `risk="write"` + `private=True` 就自动
  ——只在 TOTP 私有通道暴露、每条命令弹审批卡逐条批。
- **输出截断**：`MAX_TOOL_RESULT_CHARS` 兜底已有（A2）。

### 三条 on-prox 沙箱路为什么在这台机上都不通
| 方案 | 为什么否 |
|---|---|
| Firecracker microVM | 要 KVM（阿里云突发型 ECS 基本无嵌套虚拟化）；每 VM ≥128MB，一台 1.6G 已 OOM 的机器直接劝退 |
| on-prox Docker-per-exec | app 容器要 spawn 兄弟容器就得挂 `docker.sock` = 等于宿主 root，**比不沙箱还危险** |
| app 容器内 bwrap/nsjail | 该容器里就挂着 `.env` 全套密钥（JWT/DB/API key）、且以 root 跑，很难保证 shell 读不到；内存也没富余 |

→ **把执行挪出 prod，比在 prod 上硬做沙箱又安全又省事，还复用一大半代码。** prod 只做鉴权 + TLS 中继。

### 隔离责任的转移
「沙箱」= 跑 daemon 的那台机。它坏了你重建即可，和 prod、和你个人数据隔离。隔离强度由**你选哪台机**决定：

| 落点 | 隔离 | 适用 | 备注 |
|---|---|---|---|
| **A · 你的 Mac**（现成 mac-agent） | 弱（受限用户 + jailed cwd；**bwrap 是 Linux-only，Mac 上没有**） | 先跑通链路 / 你在旁边逐条审批的个人用法 | 隔离靠「你自己 + C2 审批」，别在 Mac 上放敏感数据的目录跑 |
| **B · 便宜可丢弃的 Linux VM**（推荐终局） | 强（bwrap namespace + seccomp + rlimits + `--unshare-net` + 整机默认禁出站 + 快照回滚） | 生产化「做事 agent」 | daemon 就是同一份代码换台机跑；VM 是 throwaway |

**建议：先 A 跑通、验证体验与协议，终局切 B。**

## 2. 架构

```
你在 /agent 私有模式发指令
  → prod FastAPI  ── 只鉴权(TOTP 私有通道) + C2 审批 + 中继，不执行 ──┐
     agent_service 循环命中 shell_exec skill                        │
        → broker.rpc(sandbox_agent_id, {cmd,...})  ── 一发一收 ──────┘
           → 现有 agent WSS ── outbound TLS ── sandbox daemon
              → daemon 用 bwrap 把命令关进 namespace 沙箱执行
              → 回传 {rc, output(截断), timed_out}
```

关键点：**新增的是 broker 上一条「一发一收 RPC」路径**，和现有「PTY↔浏览器」交互流并存、互不干扰。
不动 PTY 独占配对逻辑。

## 3. 协议改动（精确到帧）

沿用现有 `{"t": <type>, ...}` JSON 文本帧约定（`broker.make_json`）。新增两种：

**server → daemon（请求）**
```json
{"t": "exec", "id": "<uuid hex>", "cmd": "ls -la", "cwd": "workspace", "timeout": 30}
```
**daemon → server（响应）**
```json
{"t": "exec_result", "id": "<uuid hex>", "rc": 0, "output": "...", "truncated": false, "timed_out": false}
```
`id` 用于把响应路由回等待的 future（同一连接可并发多条 exec）。`output` 合并 stdout+stderr（终端语义），
daemon 侧先按字节上限截断（如 64KB），server 侧再按 `MAX_TOOL_RESULT_CHARS` 兜底。

## 4. 实现清单（三小块 + 收尾）

### 4.1 server：broker 一发一收 RPC（`terminal/broker.py` + agent ws loop）
- `AgentConn` 加两个字段：`pending: dict[str, asyncio.Future]`、`send_lock: asyncio.Lock`
  （现在 agent.ws 的 send 只在 loop 里发 pong；加了 RPC 后有两处 send，**必须上锁**）。
- 新方法：
  ```python
  async def rpc(self, agent_id: int, payload: dict, timeout: float) -> dict:
      agent = self._agents.get(agent_id)
      if agent is None:
          raise SandboxOffline
      rid = uuid4().hex
      fut = asyncio.get_running_loop().create_future()
      agent.pending[rid] = fut
      try:
          async with agent.send_lock:
              await agent.ws.send_text(make_json("exec", id=rid, **payload))
          return await asyncio.wait_for(fut, timeout)
      finally:
          agent.pending.pop(rid, None)
  ```
- agent ws loop（`terminal/router.py::agent_ws`）的文本帧分支加一条：
  `if obj.get("t") == "exec_result": fut = agent.pending.get(obj["id"]); fut and not fut.done() and fut.set_result(obj); continue`
  （在 pty_alive/pong/ping 判定旁边，**不转发给 client**）。
- `unregister_agent` 里把所有 `pending` future 置异常（daemon 掉线 → 在途命令立即失败，不吊死）。
- loop 里现有的 `await ws.send_text(make_json("pong"))` 也改成走 `send_lock`。
- 工作量：**S**。

### 4.2 daemon：非交互 exec handler + bwrap 包装（`apps/mac-agent/agent/main.py`）
- `_serve` 的文本帧处理加 `t == "exec"` 分支 → `asyncio.create_subprocess_exec(*wrap(cmd), ...)`，
  合并 stdout+stderr、`asyncio.wait_for(timeout)`（超时 kill 进程组）、字节上限截断，回 `exec_result`。
- **bwrap 包装**（Linux）：
  ```
  bwrap --unshare-all --die-with-parent
        --ro-bind / /  --dev /dev  --proc /proc  --tmpfs /tmp
        --bind <workspace> <workspace>  --chdir <workspace>
        --unshare-net                      # 默认无网络（要网的命令显式开）
        --setenv PATH /usr/bin:/bin --setenv HOME <workspace>
        -- /bin/sh -lc "<cmd>"
  ```
  绑定策略：系统只读、**只把 workspace 读写绑进去**、**不绑 daemon 自己的 config/token 目录**（`~/.tenggouwa-agent`）。
- **平台差异（重要）**：bwrap 只在 Linux 有。daemon 启动时探测：Linux 且有 bwrap → 强隔离；否则（Mac）
  → 退化成「受限用户 + jailed cwd」并在握手时上报 `sandbox_level: "weak"`，前端审批卡显式标注「弱隔离」。
- 配置：daemon config 加 `exec_enabled`（默认关，需显式开）、`workspace_dir`、`allow_network`（默认 false）。
- 工作量：**M**。

### 4.3 server：`shell_exec` skill（`app/modules/skills/shell_exec.py`）
```python
async def _handler(_session, args):
    agent_id = int(os.environ.get("AGENT_SANDBOX_AGENT_ID", "0"))
    if not agent_id:
        return "（未配置沙箱 daemon，shell_exec 不可用。）"
    if not broker.agent_online(agent_id):
        return "（沙箱 daemon 不在线。）"
    cmd = str(args.get("cmd", "")).strip()
    if not cmd:
        return "（空命令。）"
    try:
        r = await broker.rpc(agent_id, {"cmd": cmd, "cwd": "workspace", "timeout": 30}, timeout=35)
    except (SandboxOffline, TimeoutError):
        return "（沙箱不可用或命令超时。）"
    head = f"[rc={r['rc']}{' · timed_out' if r.get('timed_out') else ''}]\n"
    return head + (r.get("output") or "（无输出）")

SHELL_EXEC = Skill(name="shell_exec", description="在鉴权私有沙箱内跑一条 shell 命令……",
                   parameters={...cmd...}, handler=_handler, risk="write", private=True)
```
- `AGENT_SANDBOX_AGENT_ID` 未配 → 整个 skill 拒用（off-by-default，同 `AGENT_WORKSPACE` / `MCP_SERVERS`）。
- `risk="write"` → 自动经 C1 分级 → C2 审批；`private=True` → 只在 TOTP 私有通道暴露、公开端点/技能页不泄漏。
- 工作量：**S**。

### 4.4 收尾：审批卡显示命令（C3-lite）
- ApprovalCard 已能显示 `name + args`；给 shell_exec 的 args 里 `cmd` 单独醒目展示（等宽、完整不截断、
  标注沙箱隔离级别 weak/strong）。让「批准」前你能看清到底要跑什么。
- 工作量：**S**。

## 5. 安全模型

- **prod 永不执行**：小机只鉴权 + 中继，`.env` 密钥永不进入任何 exec 上下文。
- **纵深**：TOTP 私有通道（只有你能进）→ C2 审批（每条命令你手批）→ bwrap（namespace + seccomp + rlimits）
  → `--unshare-net`（默认无网）→ timeout + 输出上限 → daemon 跑在 throwaway VM（爆炸半径=可弃机）。
- **agent token 可撤销**：沙箱 daemon 的接入 token 在 admin 后台可随时 revoke；agent_token（进私有通道的）
  可「注销全部会话」(#153)。两层 kill-switch。
- **daemon 不暴露自身密钥**：bwrap 不绑 `~/.tenggouwa-agent`；workspace 与 config 隔离。
- **弱隔离显式化**：Mac（无 bwrap）握手上报 weak，审批卡标红提示——你知道自己在裸跑，靠人肉审批兜底。

## 6. 排期（分 PR，每步独立可测可上）

| PR | 内容 | 依赖 | 工作量 |
|---|---|---|---|
| D2-0 | broker `rpc` + `exec_result` 路由 + send_lock + 掉线失败在途 | — | S |
| D2-1 | daemon exec handler + bwrap 包装 + 平台探测 + config 开关 | — | M |
| D2-2 | `shell_exec` skill + `AGENT_SANDBOX_AGENT_ID` 门 + 测试 | D2-0/1 | S |
| D2-3 | 审批卡命令展示（C3-lite） | D2-2 | S |
| （可选）D2-4 | 抽 `ExecBackend` 接口 + 阿里云 FC「AIO Sandbox」后端 | D2-2 | L |

**测试**：
- broker rpc 单测（假 agent ws：发 exec、喂 exec_result、掉线 future 失败、超时）。
- daemon exec 单测（bwrap 有/无、超时 kill、输出截断、越狱 `../` 拒、`--unshare-net` 无网）。
- shell_exec skill 单测（未配 agent_id / daemon 离线 / mock broker.rpc 正常）。
- e2e：本地起一个 daemon（exec_enabled）+ 私有通道 → 让 agent 跑 `echo hi` → 审批 → 收 rc/output。

## 7. 与 roadmap 原设想的差异（为什么改）

roadmap §D0 原推「阿里云 FC AIO Sandbox + `SandboxBackend` 接口 + Redis 存句柄」。两处和现状不符：

1. **「已有 Redis」是错的**：本轮确认栈里**没有 Redis**（`grep` 全仓无 redis 依赖/客户端）。限流 (#152) 都是
   进程内实现。FC 那套「Redis 存句柄 + TTL + reaper」等于要**先引入 Redis**，额外一大块。
2. **忽略了现成的 broker/daemon**：那套远程执行 + 鉴权 + outbound-only 传输**已经上线**，复用它比对接一个
   新的云 REST 沙箱服务快得多、也不引第二个外部依赖。

**FC AIO Sandbox 不是被否，是被降级为「可选的 D2-4 后端」**：等哪天 daemon 机的维护成本或隔离级别真成瓶颈，
在 `ExecBackend` 接口后面加一个 FC 后端即可 —— `shell_exec` skill 和整条授权/审批链**一行不用改**。它的优点
（平台级隔离、scale-to-zero、零机器维护、闲置不烧钱）在「你不想自己维护沙箱机」时才值得那份集成成本。

## 8. 需要你拍的板

1. **沙箱 daemon 先落哪**：A（你的 Mac，先跑通）还是直接 B（便宜可丢弃 Linux VM）？（建议先 A 后 B）
2. **默认网络**：沙箱内命令默认**无网**（`--unshare-net`），要网的命令显式开——认可吗？
3. **超时/输出上限**：默认 30s / 64KB，够不够？

拍完我按 §6 的 PR 顺序开工。
