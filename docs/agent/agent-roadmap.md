# apps/agent → 「像 Claude/Codex」的分阶段 roadmap（细化版）

> 目标(用户 2026-07-08 定):都要,慢慢做,分阶段来。
> 前置:[agent-architecture-research.md](./agent-architecture-research.md)(两家逐层拆解)、
> [agent-v2-design.md](./agent-v2-design.md)(已落地内核)。
>
> **现状(已具备)**:统一流式 tool-calling 循环(`stream_step`)、多轮记忆 + append-only 会话、
> prompt cache、极简 compaction、4 skill(kb_search / update_plan / web_fetch / ask_user)、
> SSRF 守卫、前端流式 + plan checklist + ask 选项卡 + markdown(表格/代码/链接)。
> code review 关卡已加(见 [[feedback_verify_local_before_deploy]])。
>
> **缺的不是架构,是能力面 + 工程硬度。** 排序铁律:
> **A 地基 → B 扩展性 → C 安全闸 → D 强能力 → E 规模 → F 打磨**。D 之前必须先有 C。

每个 sub-phase = 一个 PR,走「本地验证 → code review → 部署」。下面每项给:**做什么 / 改哪 / 怎么做 / 验收 / 工作量·风险**。

---

## Phase A0 — 回归 / 测试地基（在加任何功能之前先建）

**动机**:此前是"写一次性 repro 脚本 → 手动 curl → 丢掉",不是回归。加 A–F 这么多功能,没系统化回归,改坏了发现不了。LLM agent 测试的根本难点:**模型非确定 + 联网 + 花钱 + 会抖**——不能拿"端到端跑真模型"当主力,必须把「逻辑」和「模型行为」分层拆开测。

### 五层测试策略

| 层 | 测什么 | 确定性 | 跑在哪 | 现状 |
|---|---|---|---|---|
| **1 单元** | 纯函数(`_strip_leak`/`_merge_tool_call_deltas`/skill handler/`_est_tokens`) | ✅ 快 | CI 每次 | ✅ 26 个 |
| **2 循环集成(mock LLM)** | `answer_stream` 全流程:mock `stream_step` 喂脚本事件 + 内存 repo,断言 SSE 事件/消息配对/落库/边界 | ✅ 快 | CI 每次 | ⚠️ 仅 1 个(H1),**要泛化成主力** |
| **3 provider 解析 golden** | 录制的真实 SSE 字节(含 `｜` 泄漏、分片 tool_calls、usage chunk)喂 `stream_step` 解析,断言 | ✅ | CI 每次 | ❌ 无 |
| **4 前端组件** | `renderMarkdown`(表格/代码/链接)、`AskPanel`、SSE 事件处理 | ✅ | CI 每次 | ❌ apps/agent 未接 vitest |
| **5 真模型冒烟(live)** | 金标准场景跑真 DeepSeek,断言不变量 | ❌ 慢/花钱/抖 | **发版前本地 + 夜间 cron**,不进普通 CI | ⚠️ 手动 curl,待固化 |

### A0 要建的东西

- **A0-1 脚本化 LLM 循环测试框架(最高杠杆,第 2 层)**:能自动抓住我们踩过的绝大多数 bug(泄漏/隐藏 preamble/悬空引用/ask_user/plan/多工具/预算/H1),**全程不联网**。泛化 H1 那个测试:
  ```python
  class ScriptedLLM:            # 假 LLM，按脚本逐轮 yield stream_step 事件
      def __init__(self, rounds): self.rounds, self.i = rounds, 0
      async def stream_step(self, messages, *, tools=None, **k):
          for ev in self.rounds[self.i]: yield ev
          self.i += 1
  # + 内存 FakeRepo（已有雏形） + 可复用不变量断言：
  #   assert_paired(rows)   每个 assistant(tool_calls) 后必跟配对 tool 结果
  #   assert_no_leak(ans)   "｜" not in ans
  #   assert_replayable(rows) 能重建成合法 messages（DeepSeek 不 400）
  ```
  场景覆盖:`多工具并行` / `ask_user 收尾` / `plan 事件` / `content 混入泄漏` / `skill 抛异常` / `预算超限` / `compaction 触发`。每个确定性、毫秒级。
- **A0-2 provider golden 测试(第 3 层)**:录几段真实 DeepSeek SSE(正常/带 `｜` 泄漏/分片 tool_calls/末尾 usage)存 fixture,喂 `stream_step` 断言解析结果。
- **A0-3 前端 vitest(第 4 层)**:apps/agent 接 vitest + testing-library,测 `renderMarkdown`(表格/代码/链接/`---`)、`AskPanel`(选项/其他输入/提交)、`handleEvent` SSE 分发。
- **A0-4 live 冒烟套件(第 5 层)**:`apps/server/tests/live/test_smoke.py`,**env flag(`RUN_LIVE_TESTS`)+ `KB_LLM_API_KEY` 门控**(没 key 自动 skip,不进普通 CI)。把 `repro_e2e`/`repro_fallback` 固化成断言式:梅兰芳回退、抓X 多工具、代码答案不截断、ask_user 触发——每个断言"无 `｜`、无悬空、工具执行、答案非空"。发版前本地跑 + 夜间 cron。
- **A0-5 golden scenario corpus 纪律**:**每修一个 bug → 加一个永久场景测试,只增不减**(泄漏/截断/悬空/H1/NUL 字节都补上)。这是回归的核心资产。

### 门禁分层
- **CI(ci.yml)**:只跑 1–4 层(不联网、不花钱、不 flaky)。
- **部署前(本地)**:涉及模型行为的改动,第 5 层 live 冒烟本地必须绿 —— 就是之前漏掉那几次的补丁。
- **夜间 cron**:第 5 层全量 live,防模型行为漂移。

**验收**:`ScriptedLLM` + 不变量断言 + 现有场景(H1/泄漏/ask_user/多工具)补齐;前端 vitest 跑起来;live 冒烟套件可 `RUN_LIVE_TESTS=1` 本地跑通。此后每个功能(A–F)自带第 2 层场景测试。

工作量 **M**,风险低,**收益极高(后面每一步都有自动回归兜底)**。

---

## Phase A — 工程硬度地基（先做,低风险高价值）

已踩过其中的坑(本机连 DeepSeek 抖就崩、无工具输出预算)。

### A1 · LLM/工具调用重试 + 超时
- **改哪**:[provider.py](../apps/server/app/modules/kb/provider.py) `ChatLLM`。
- **怎么做**:`complete` / `stream_step` 外层加指数退避重试(`tenacity` 或手写):对 `httpx.ConnectError` / `ReadTimeout` / 5xx / 429 重试 2–3 次(退避 0.5/1/2s)。**流式的坑**:只在**首个 token 到达前**的连接失败可安全重试;已开始流式再断则不重发(避免重复输出),转 SSE error。对齐 Codex `responses_retry`。
- **验收**:拔网/代理抖动时自动重试成功;单测 mock httpx 抛 ConnectError → 第 2 次成功。
- 工作量 S,风险低。

### A2 · 工具输出预算 / 截断
- **改哪**:[agent/service.py](../apps/server/app/modules/agent/service.py) 工具执行处 / 或 skills 层统一。
- **怎么做**:每个 tool 结果落库 + 回灌前统一截断到 `MAX_TOOL_RESULT_CHARS`(如 8000),超出尾部替换成 `…[已截断 N 字]`。对齐 Codex `exec_command max_output_tokens=10000`。web_fetch 已自截,kb_search / 未来 shell 输出需要这层兜底。
- **验收**:构造超大 tool 结果 → 上下文不被撑爆、有截断提示;单测覆盖。
- 工作量 S,风险低。

### A3 · 取消 / 断连清理
- **改哪**:service.py answer_stream / router。
- **怎么做**:客户端断开时 StreamingResponse 生成器收到 `CancelledError` → 干净停止(H1 已保证 assistant↔tool 配对;确认取消时不留半条脏消息)。可加 `asyncio` 超时上限防单轮无限跑。
- **验收**:中途关连接,DB 不留孤儿、无异常刷屏。
- 工作量 S,风险低。

### A4 · 成本 / 用量可观测
- **改哪**:provider `stream_step`(已从末尾 chunk 拿到 usage)、service、前端 [Ask.tsx](../apps/agent/src/pages/Ask.tsx)。
- **怎么做**:把每轮 usage(prompt/completion/cache hit tokens)累计,SSE 发一个 `{type:"usage"}` 事件;前端角落小字显示"本轮 ~X tokens / 命中缓存 Y%"。DeepSeek 有 `prompt_cache_hit_tokens`。
- **验收**:多轮对话能看到 token 与缓存命中随轮次变化(顺带验证 prompt cache 真生效)。
- 工作量 S,风险低。

> **A 产出**:agent 抗抖、上下文不被单工具撑爆、花费可见。**从这里开工。**

---

## Phase B — 扩展性:让"加能力"变便宜

当前加 skill = 改 Python registry + 部署。目标:动态化 + 接 MCP 生态。

### B1 · skill 运行时开关
- **改哪**:[skills/registry.py](../apps/server/app/modules/skills/registry.py) / 新增 DB 表或配置。
- **怎么做**:给每个 skill 加 enabled 标志(DB 或 config),`skills_service.tools()` 只出启用的。**注意 prompt cache 前缀**:启用集变化会动 tools 前缀(一次性 miss,可接受);顺序仍固定。
- **验收**:后台开关某 skill,agent tools 立即增减,不改代码。
- 工作量 S,风险低。

### B2 · MCP 客户端（核心扩展性,接入整个工具生态）
调研见子 agent 结论,要点:
- **新模块** `apps/server/app/modules/mcp/`(对齐现有 modules 约定)。装 **`mcp` v1.x**(`uv add "mcp>=1,<2"`,**别用 v2 预发布**)。
- **连接**:`MCPManager` 在 FastAPI **app lifespan 起长连、复用 session**(`AsyncExitStack` 托管),别每会话重启子进程。传输:本地 `stdio_client`(起子进程,如 filesystem/git server)、远程 `streamablehttp_client`。**anyio 坑**:CM 必须同一 task enter/aclose,故用常驻 manager。
- **桥接成 skill**:每个 MCP tool → 生成一个 OpenAI function,name = `<server>__<tool>`(sanitize 到 `^[a-zA-Z0-9_-]+$`、≤64 字,建映射表路由);`inputSchema` 剥掉 `$schema`/`default` 后直接当 `parameters`;调用结果 content blocks 抽 text 拼成字符串回灌(`isError` 前缀 `[tool error]`)。与现有 skill 在 loop 里长得一样。
- **cache 前缀稳定(必做)**:MCP `tools/list` **不保证顺序**、`tools/list_changed` 会重排 → 每次乱序毁掉 prompt cache 前缀(Codex/OpenClaw 踩过并专门修)。合并进 tools 前**按 `(server, tool)` 字典序确定性排序**;`list_changed` 后重列 + 重排;临时停用某 server 优先"禁用占位"而非删,减少前缀 churn。
- **安全(见 Phase C 强关联)**:只连**配置里白名单的可信 server**(不接受运行时注入 server 地址);工具级白名单;写/危险工具走 C 的审批;工具返回当**不可信输入**防 prompt-injection(标注 `<tool_result>` 边界);远程 server 防 SSRF(屏蔽私网、禁内网重定向)、强制 HTTPS、不 token passthrough。
- **先接哪个**:用官方 `Everything`/`filesystem`(限死 allowed root)联调桥接 + 排序 + 审批,再按需接 `fetch`/`git`/`github`。官方 registry:`github.com/modelcontextprotocol/registry`。
- **验收**:配一个 filesystem MCP server,agent 能列出并调用其工具;tools 顺序稳定(cache 命中不掉);默认全部"需审批"。
- 工作量 **L**,风险中(连接生命周期 + 安全)。

### B3 · skills 页可管理
- knowledge-base/skills 前端页从只读 → 增删/开关 skill、查看/配置 MCP server。
- 工作量 M,风险低。

> **B 产出**:此后加能力 = "接一下" 而非"改代码+部署"。

---

## Phase C — 权限 / 审批层（D 的硬前置）

当前工具都只读安全故跳过。**一旦 D 引入写文件/跑命令,这层必须先有。**

### C1 · 工具风险分级 + allow/deny
- **改哪**:skills `Skill` dataclass 加 `risk`(readonly/write/exec)字段;MCP 工具默认 exec/需审批。
- **怎么做**:deny-first 规则(对齐 Claude);内置只读工具(kb_search/web_fetch)auto 放行,write/exec 默认需审批。
- 工作量 S。

### C2 · 审批流（人在环上）
- **怎么做**:agent 要调危险工具时,**不直接执行**——发 `{type:"approval_request", tool, args}` SSE,**本轮以待批收尾**(复用 ask_user 的"结束本轮、下一轮续上"机制);前端弹确认卡(展示工具+参数),用户点"批准/拒绝"→ 作为特殊输入发下一轮 → 批准则真正执行、拒绝则回一条"用户拒绝"tool 结果。**为什么这样**:我们 SSE 是单向逐轮,不做双向暂停,复用已验证的 asked 收尾模式最稳。
- **验收**:调 write 工具时弹审批卡;批准后执行、拒绝后 agent 据此调整。
- 工作量 M,风险中。

### C3 · 危险命令规范化判定（D 的 shell 用）
- 对齐 Codex execpolicy:命令先规范化(防 `r''m` 绕过)再按白/黑名单判 auto/ask/deny。
- 工作量 M,和 D3 一起做。

> **C 产出**:给 agent 强能力时有闸可关。C 可与 A 并行起草。

---

## Phase D — 能真正「干活」的工具 + 执行环境（向 Codex 看齐,最大投入）

"问答 agent"→"做事 agent"的分水岭。**难点在隔离沙箱,不在工具代码。**

### D0 · 沙箱基础设施选型（先定这个,最大不确定性）
调研结论(**铁律:绝不在 1.6G 主机上跑用户/LLM 代码**——已 OOM + 逃逸会端掉主服务):
- **抽象层**:新增 `apps/server/app/modules/sandbox/`,定义 `SandboxBackend` 接口:`create()→handle` / `exec(handle,cmd)→result` / `put_file`/`get_file` / `destroy(handle)`。业务与具体后端解耦,换隔离不动上层。句柄/生命周期状态存 **Redis**(已有),带 TTL + 心跳 + 空闲 reaper。
- **MVP 二选一**:
  - **(推荐) 阿里云函数计算 FC「AIO Sandbox」**:原生"浏览器 + code interpreter + shell + 文件上传下载 REST API",生命周期 `CREATING→READY→TERMINATED` + 空闲自动销毁,**正好对上 create→exec→destroy**;scale-to-zero、闲置不烧钱、新用户每月 15 万 CU 免费;已在阿里云、零第二台机维护、隔离平台兜底。代价:有冷启动(你说宁可慢,可接受)、文件走复制而非挂载。
  - **(备选) 独立便宜"沙箱专用 VM" + 加固 Docker**:整机默认禁出站,FastAPI 经远程 Docker API 按会话拉容器(`--network none / --memory / --pids-limit / --read-only / --cap-drop=ALL / --security-opt no-new-privileges` + 默认 seccomp),workspace 挂卷,用完删。成本固定可预测、环境全自控;代价:多一台机维护、隔离非顶级(共享内核)。
- **演进**:走 VM 路线且不受信程度上升 → 给 Docker 挂 **gVisor(`--runtime=runsc`)** 一行改动拉满隔离(吃性能损耗);再上 Firecracker microVM(需 KVM 专用机)。走 FC 则隔离已够,主要补出网白名单 + 审计。
- **网络**:默认禁,按需白名单(对齐 Codex)。
- 工作量 **L**(选型 + 接口 + 一个后端实现),风险 **高**(基础设施)。**开工前先单独拍板 FC vs VM。**

### D1 · 文件工具
- read / write / edit,scope 限死在 sandbox workspace 内;走 A2 输出截断、C1 风险分级(write 需审批)。
- 工作量 M(依赖 D0)。

### D2 · shell 工具
- bash,受 C2 审批 + C3 命令判定 + D0 沙箱 + A2 截断 + 超时约束。对齐 Codex `exec_command`(`yield_time_ms`/`max_output_tokens`)。
- 工作量 M(依赖 D0/C3)。

> **D 产出**:agent 能在隔离环境读写文件、跑命令、完成任务。**做完这层才算"像 Codex"。**

---

## Phase E — 子 agent 编排（复杂/大任务）

### E1 · Task / 子 agent 工具
- 新 skill `spawn_agent`:派生一个**独立上下文**的子 answer_stream 干脏活(读一堆文档/文件),**只回摘要**给主 agent(对齐两家 subagent,脏活不污染主上下文)。子 agent 复用同一 loop、独立 session。
- 工作量 M。

### E2 · 并行 + 深度上限
- 对齐 Codex `max_threads=6 / max_depth=1`(默认禁子 agent 再套子 agent,防递归爆炸)。
- 工作量 S。

> **E 产出**:大任务拆开并行做,不撑爆主上下文。

---

## Phase F — 打磨 / parity（穿插着做）

- **F1 多模态输入**:图片/PDF。**注意**:`deepseek-chat` 是文本模型,视觉要换 `deepseek-vl` 或多模态端点——先确认模型支持再做。你调试一直贴截图,这个很实用。工作量 M。
- **F2 会话 resume / fork UI**:已落库(agent_session/agent_message),缺"历史会话列表 + 继续 + 分叉"界面。工作量 M。
- **F3 模型选择 / reasoner**:hard 任务切 `deepseek-reasoner`(带 reasoning_content),或让用户选模型。工作量 S。
- **F4 extended thinking 露出**:把推理过程可选折叠展示。工作量 S。

---

## 追不平的 & 不抄的

- **追不平**:模型质量(DeepSeek vs GPT-5-Codex/Opus),只能靠 F3 切 reasoner 缓解。
- **不抄**:五层 compaction(A2 单层够)、无状态 ZDR(不受合规约束)——它们为自己问题付的税。

---

## 推进顺序建议

0. **Phase A0**(回归/测试地基)← **最先建**,之后每个功能才有可验证方式(明天开工)
1. **Phase A**(工程硬度,已有痛点)A1/A2 最先
2. **Phase C** 起草(与 A 并行)——权限模型先定
3. **Phase B2 MCP**(扩展性核心)——一次性接入工具生态
4. **Phase D0 沙箱选型**(拍板 FC vs VM,最大不确定性)→ D1/D2
5. **E / F** 穿插

关联 [[project_agent_app]]。沙箱与 MCP 的完整调研在本次会话的两个子 agent 输出里(要落到单独文档可再说)。
