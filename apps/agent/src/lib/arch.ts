// Agent 架构解剖器的内容树：骨架用业界通用 taxonomy（harness engineering），血肉用本站真实实现。
// 纯静态数据，零后端。正文是 markdown（复用 renderMarkdown 渲染，代码块/链接都支持）。
// P1：编排循环 / 能力层 / 记忆 / 安全 四个核心节点写透（带二级架构 children）；其余层给概念+实现。

const REPO = 'https://github.com/tenggouwa/Tenggouwa-site/blob/main';

export type Layer =
  | 'entry'
  | 'loop'
  | 'context'
  | 'tools'
  | 'mcp'
  | 'orchestration'
  | 'planning'
  | 'memory'
  | 'rag'
  | 'security'
  | 'reasoning'
  | 'observability'
  | 'infra';

export interface Source {
  title: string;
  url: string;
}

export interface ArchNode {
  id: string;
  title: string;
  tag?: string; // 图上标题下的一行小字
  core?: boolean; // 核心节点：图上高亮 + 有二级架构
  summary: string; // 抽屉头部一句话
  concept: string; // md：概念 + 2026 最新技术
  implementation?: string; // md：我的实现（带真实文件链接）
  code?: { caption?: string; body: string }; // 真实代码片段（从仓库摘的，非示意）
  flow?: string[]; // 数据流走查：一个请求/查询实际怎么一步步流动（有序步骤）
  pitfall?: string; // md：坑 / 教训——naive 做法会怎么坏 + 真实战例
  tech?: string[]; // 技术要点 chips
  children?: ArchNode[]; // 二级架构
  sources?: Source[]; // 延伸阅读
}

// 主图分层（自上而下 = 请求流）。每行一组并列节点。
export interface ArchRow {
  layer: Layer;
  nodes: ArchNode[];
}

export const ARCH: ArchRow[] = [
  {
    layer: 'entry',
    nodes: [
      {
        id: 'entry',
        title: '入口 / 通道',
        tag: 'public · private(TOTP) · SSE',
        summary: '两条能力隔离的通道 + 流式协议，是整套 agent 的边界。',
        concept:
          '一个 agent 对外的第一道设计不是模型，是**边界**：谁能调、能调到什么、结果怎么流回去。\n\n' +
          '2026 的共识是**能力按身份分层暴露**：匿名/公开身份只给只读、无副作用的工具；可信身份才解锁写操作与高危工具。' +
          '流式协议（SSE / streaming）让"边想边说边调工具"成为默认交互，而不是一次性等完整答案。跨 agent 协作则催生 A2A 等协议。',
        implementation:
          '本站拆**两条通道**：\n\n' +
          `- **公开** \`POST /api/public/agent/chat\`（免鉴权）：只暴露 readonly 且非 private 的原生 skill。\n` +
          `- **私有** \`POST /api/agent/chat\`：TOTP 解锁换长 TTL \`agent_token\`（派生密钥签名，不是拿 admin token 冒充），额外给 write / MCP / 文件 / shell。\n\n` +
          `两条共用同一段 prompt cache 前缀（SYSTEM 逐字不变），私有多追加一条 PRIVATE_SYSTEM。SSE 事件：\`token/tool/tool_output/plan/ask/approval/reasoning/usage/done\`。\n\n` +
          `代码：[router.py](${REPO}/apps/server/app/modules/agent/router.py) · [auth.py](${REPO}/apps/server/app/modules/agent/auth.py)`,
        tech: ['SSE 流式', 'TOTP → 派生密钥 token', '双通道能力隔离', 'A2A(前沿)'],
        children: [
          {
            id: 'entry-channels',
            title: '双通道能力隔离',
            summary: '公开只读 / 私有(可写+MCP+沙箱)，一套代码两种能力面。',
            concept: '安全边界的第一原则：匿名身份永远拿不到写/高危工具。把"暴露什么"做成通道属性，而不是靠 prompt 劝模型别乱来。',
            implementation: `\`skills_service.tools(privileged)\` 是唯一能力暴露点：公开只给 readonly 非 private；私有额外给 write/MCP。\`invoke\` 再纵深拦一层（幻觉出高危名也拒）。[permissions.py](${REPO}/apps/server/app/modules/skills/permissions.py)`,
          },
          {
            id: 'entry-totp',
            title: 'TOTP → 派生密钥 token',
            summary: '6 位 TOTP 解锁换长 TTL agent_token，用派生密钥签而非主密钥。',
            concept: '私有通道要能"记住已授权"又不长期暴露主密钥——短码解锁换一个作用域受限的 token。',
            implementation: `token 用 \`sha256(AUTH_JWT_SECRET:agent-token-v1)\` 派生密钥签（若用主密钥，current_admin 会把它当 admin token 放行 = 公开 TOTP 换全 admin 权限）。TTL 默认 4h。[auth.py](${REPO}/apps/server/app/modules/agent/auth.py)`,
            code: {
              caption: 'auth.py — 派生密钥',
              body: `def _secret() -> str:
    base = config.get("AUTH_JWT_SECRET")
    # 关键：agent_token 用派生密钥签，不用主密钥。否则 current_admin 不校验 type，
    # 会把 agent_token 当 admin token 放行 = 公开 TOTP 直接换全 admin 权限。
    return hashlib.sha256(f"{base}:agent-token-v1".encode()).hexdigest()

token = jwt.encode({"sub": owner, "type": "agent", "ep": epoch, ...}, _secret(), "HS256")`,
            },
          },
          {
            id: 'entry-sse',
            title: 'SSE 事件协议',
            summary: 'token/tool/tool_output/plan/ask/approval/reasoning/usage/done。',
            concept: '流式不只是打字机效果：不同事件类型让前端边跑边渲染工具行、审批卡、思维链、进度计划。',
            implementation: '服务端 yield 结构化事件，前端按 type 分发到对应 UI。工具实时输出(shell/子代理)走 tool_output 复用同一终端框。',
          },
        ],
        sources: [
          {
            title: 'Writing effective tools for AI agents — Anthropic',
            url: 'https://www.anthropic.com/engineering/writing-tools-for-agents',
          },
        ],
      },
    ],
  },
  {
    layer: 'loop',
    nodes: [
      {
        id: 'loop',
        title: '编排循环 Agent Loop',
        tag: '感知 → 决策 → 行动 → 观察',
        core: true,
        summary: '整套 agent 的心脏：一个"模型决策 → 执行工具 → 回灌结果"的流式循环，直到不再调工具。',
        concept:
          '几乎所有 agent 底层都是同一个循环：**Thought → Action → Observation**（ReAct 范式）。模型看当前上下文 → 决定调哪个工具 → ' +
          '工具结果回灌 → 再决策，直到它认为可以直接作答。\n\n' +
          '2026 的关键工程点在**终止与预算**：不设小硬上限（对齐 Codex/Claude Code 的"没有 magic step 数"），而是靠' +
          '"模型不再发起 tool_call"自然终止 + token 预算兜底防失控。另一分支是 **Plan-then-Execute**（先出计划再逐步执行）与 ' +
          '**Reflection**（产出后自审再定稿），适合长程任务。',
        implementation:
          '本站的 [`answer_stream`](' +
          REPO +
          '/apps/server/app/modules/agent/service.py) 是一个**统一流式循环**：每一步都带 tools 流式跑，正文实时显示、tool_calls 从结构化 delta 解析后执行、结果回灌，进入下一步。\n\n' +
          '- 终止 = 模型这一步没有 tool_call（自然收口），而非固定步数。\n' +
          '- `MAX_STEPS=16` 只是**兜底防死循环**；`STEP_TOKEN_BUDGET=40_000` 累计工具往返超了强制收尾。\n' +
          '- **H1 不变量**：带 tool_calls 的 assistant 消息，后面必须紧跟等量的 tool 结果——否则 resume 时 DeepSeek 会 400（会话毒化）。这条贯穿落库、审批暂停、并发汇流。',
        code: {
          caption: 'service.py — answer_stream 主循环',
          body: `for _ in range(MAX_STEPS):                    # 兜底防死循环，非常规上限
    content, tool_calls = "", []
    async for ev in chat_llm.stream_step(messages, tools=tools, model=model):
        ...                                       # 正文 delta 实时 yield、攒 tool_calls

    if not tool_calls:                            # 没工具调用 = 本轮正文即最终答案
        answered = True
        break                                     # ← 自然终止，不是固定步数

    messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
    await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
    async for ev in self._execute_batch(...):     # 执行工具 → 结果回灌 messages
        yield ev                                  # 下一轮 stream_step 带着结果再决策`,
        },
        flow: [
          '用户发一句话 → 建/续会话，落库这条 user 消息（append-only，带 seq）。',
          '`_seed` 装配 messages：`SYSTEM`(+私有 `PRIVATE_SYSTEM`) + tools 恒在前 → 早前摘要 → 历史 → 召回的长期记忆 → 这条 user。',
          '`stream_step` 带着 tools 流式调 LLM：正文 delta 实时推给前端，`tool_calls` 从结构化 delta 攒齐。',
          '**没有 tool_call？** → 这段正文就是最终答案，落库、发 `done`，本轮结束。',
          '**有 tool_call？** → 落 assistant(tool_calls) → `_execute_batch` 执行(并发/审批/沙箱) → 每个结果作为 tool 消息回灌 messages。',
          '回到第 3 步：带着工具结果再调 LLM。如此循环，直到某轮不再 tool_call（或撞 MAX_STEPS/预算兜底）。',
        ],
        pitfall:
          '**最阴险的坑是"会话毒化"（H1）**：DeepSeek 要求带 `tool_calls` 的 assistant 消息后面必须紧跟等量的 tool 结果，' +
          '否则下次 resume 逐字节重建 messages 时直接 **400**，整个会话作废。\n\n' +
          '所以任何"中途停下"的时刻都危险：C2 审批暂停、并发只跑完一半、异常。解法是**暂停时干脆不落 assistant(tool_calls)**' +
          '（存进 `pending`，批准续跑才落），并发结果**按原 tool_call 下标**回填。测试 `assert_paired` 专门守这条。',
        tech: ['ReAct 循环', 'MAX_STEPS=16 兜底', 'token 预算', 'H1 配对不变量', '流式 tool_call 解析'],
        children: [
          {
            id: 'loop-step',
            title: '单步 stream_step',
            summary: '一步 = 一次带 tools 的流式 LLM 调用，边出正文边攒 tool_calls。',
            concept: '把"生成"和"决策"合进一次流式调用：正文 delta 实时推给前端，tool_call delta 累积成完整调用结构后再执行。',
            implementation: `provider 层 [\`stream_step\`](${REPO}/apps/server/app/modules/kb/provider.py)：解析 \`delta.content\` / \`delta.tool_calls\` / \`delta.reasoning_content\`，首个 yield 前可重试（网络抖动），已开始则透传。`,
          },
          {
            id: 'loop-terminate',
            title: '终止与预算',
            summary: '没有小硬上限；靠"不再 tool_call"终止 + 预算/步数兜底。',
            concept: '对齐 Codex/Claude Code：不给 agent 设 magic 的步数上限（会误伤复杂任务），只保留防失控的软兜底。',
            implementation: '`MAX_STEPS=16`、`STEP_TOKEN_BUDGET=40_000`；超预算 append 一条提示让模型收尾。',
          },
          {
            id: 'loop-h1',
            title: 'H1：消息配对',
            summary: 'assistant(tool_calls) 必须紧跟等量 tool 结果，否则会话毒化。',
            concept: 'append-only 会话逐字节重建 messages 以保住缓存前缀——一旦出现孤儿 tool_call，DeepSeek 直接 400。',
            implementation: 'C2 审批暂停时**不落** assistant(tool_calls)（存进 `pending`），批准续跑才落，避免孤儿。测试 `assert_paired` 守这条。',
            code: {
              caption: 'service.py — 审批暂停时不落 assistant',
              body: `need = [tc for tc in tool_calls if requires_approval(_tc_name(tc))]
if need:
    # 关键：不 append 也不 repo.append assistant(tool_calls)——否则这条 assistant
    # 后面没有配对的 tool 结果 = 孤儿 tool_call，resume 时 DeepSeek 直接 400。
    await repo.set_pending(sid, {"content": content, "tool_calls": tool_calls})
    yield {"type": "approval", "requests": [...]}
    answered = True
    break                        # 用户批/拒后带 approvals 续跑，那时才真正落库`,
            },
          },
        ],
        sources: [
          {
            title: 'Building Effective AI Agents — Anthropic',
            url: 'https://www.anthropic.com/engineering/building-effective-agents',
          },
          { title: 'awesome-harness-engineering', url: 'https://github.com/ai-boost/awesome-harness-engineering' },
        ],
      },
    ],
  },
  {
    layer: 'context',
    nodes: [
      {
        id: 'context',
        title: '上下文工程',
        tag: 'prompt cache · compaction · 注入',
        summary: '决定"每一步喂给模型什么"——2026 公认比 prompt 本身更影响 agent 质量。',
        concept:
          '**Context Engineering** 是 2026 的核心命题：不是写好一句 prompt，而是设计"信息架构"——system 怎么搭、历史怎么压、' +
          '记忆/检索怎么按需注入、什么时候遗忘。子命题包括**压缩蒸馏**（摘要/事实抽取降 token）、**时间管理**（短期 vs 长期、会话内 vs 跨会话、遗忘衰减）、' +
          '**推理脚手架**（计划产物、角色框定）。',
        implementation:
          '本站几处：\n\n' +
          '- **稳定缓存前缀**：SYSTEM + tools 恒定在前、变动在后（REGISTRY 顺序都锁死），DeepSeek 上下文缓存命中便宜一个数量级。\n' +
          '- **compaction**：历史超 `COMPACT_TOKENS=24_000` 把最近 `KEEP_TURNS=3` 轮之前摘要成一条 note，边界钉在 user 消息防孤儿。\n' +
          '- **结果截断** `MAX_TOOL_RESULT_CHARS=8000` 防单个工具输出撑爆上下文。\n' +
          '- **记忆注入**：把召回的长期记忆作为一条 system 备注塞在缓存前缀**之后**（见"记忆"节点）。\n\n' +
          `代码：[service.py](${REPO}/apps/server/app/modules/agent/service.py)`,
        tech: ['prompt cache 前缀', 'compaction', '结果截断', '记忆注入', 'SYSTEM 只讲策略'],
        children: [
          {
            id: 'context-cache',
            title: '稳定缓存前缀',
            summary: 'SYSTEM + tools 恒定在前、变动在后，缓存命中便宜一个数量级。',
            concept: 'DeepSeek 上下文缓存对"逐字节相同的前缀"才命中。所以一切固定内容排最前、一切变动排最后——连工具注册表顺序都锁死。',
            implementation: '`_seed` 把 SYSTEM 放第一块逐字不变；私有多追加一条独立的 PRIVATE_SYSTEM（不改 SYSTEM）；REGISTRY append-only。前缀命中率实测 87~98%。',
            code: {
              caption: 'service.py — _seed 消息装配',
              body: `def _seed(window, privileged=False):
    messages = [{"role": "system", "content": SYSTEM}]   # 首块逐字不变 = 缓存前缀
    if privileged:                                        # 私有：独立追加，不改 SYSTEM
        messages.append({"role": "system", "content": PRIVATE_SYSTEM})
    if window.summary:                                    # compaction 产物
        messages.append({"role": "system", "content": f"[早前摘要]\\n{window.summary}"})
    messages.extend(window.messages)                      # 变动部分一律排最后
    return messages
# tools 也恒定在前（REGISTRY 顺序锁死）→ SYSTEM+tools 前缀逐字节稳定 → 命中缓存`,
            },
          },
          {
            id: 'context-compact',
            title: 'compaction 压缩',
            summary: '历史超 24K token，把最近 3 轮之前摘要成一条 note。',
            concept: 'Claude 五层压缩里只做最顶层：不是每层都压，而是"太老的对话"整体蒸馏成摘要，省 token 又不丢主线。',
            implementation: '`COMPACT_TOKENS=24_000` / `KEEP_TURNS=3`；边界钉在 user 消息（防切在 assistant(tool_calls) 和 tool 之间产生孤儿）。',
            pitfall:
              '**摘要的"切点"不能随便选。** 如果切在一个 assistant(tool_calls) 和它的 tool 结果**之间**，摘要之后的历史里就出现了' +
              '一个没有配对结果的孤儿 tool_call → 又是 H1 那个 400。\n\n' +
              '**教训**：compaction 边界必须钉在 **user 消息**上(一个完整回合的起点)，保证摘要切口两侧都是配对完整的消息序列。' +
              '压缩省 token 是好事，但不能以破坏消息不变量为代价。',
          },
          {
            id: 'context-strategy',
            title: 'SYSTEM 只讲策略',
            summary: 'SYSTEM 永不点名工具，"何时用我"交给各 skill 的 description。',
            concept: '在 system 里点名工具有三宗罪：每加 skill 就改提示词(打断缓存)、覆盖 description(工具选不中)、两处真相不同步。',
            implementation: `写"涉及本站内容先查知识库"而非"先用 kb_search"。守卫测试 \`test_system_prompt_names_no_tools\` 防长回来。加新 skill = 1 文件 + 1 行注册 + 0 行提示词。`,
          },
        ],
        sources: [
          { title: 'Context Engineering for AI Agents 2026 — mem0', url: 'https://mem0.ai/blog/context-engineering-ai-agents-guide' },
        ],
      },
    ],
  },
  {
    layer: 'tools',
    nodes: [
      {
        id: 'tools',
        title: '能力层 Tools / Skills',
        tag: 'schema · 结果语义 · 并发 · 去重',
        core: true,
        summary: 'agent 能做什么，全在这一层。工具的 schema 和结果语义直接决定模型选得对不对、会不会打转。',
        concept:
          '工具设计是 agent 工程里最被低估的一环。要点：**严格 schema**（约束参数、enum 防幻觉）、**结果语义**（让模型分清成功/空/错，' +
          '否则会盲目重试）、**并行调用**（无依赖工具并发）、**风险标注**（工具自带 readonly/write 标签供权限判定）。\n\n' +
          'Anthropic 甚至用一个"工具测试 agent"专门重写有缺陷的工具描述——改进描述让后续任务完成时间降 40%。**描述就是路由逻辑。**',
        implementation:
          '本站的 [`Skill`](' +
          REPO +
          '/apps/server/app/modules/skills/base.py) dataclass = 名字 + 描述 + JSON schema + handler + `risk(readonly|write)` + `private`。铁律：**SYSTEM 只讲策略、永不点名工具**，"何时用我"交给各 skill 的 description（点名过会导致 kb_graph 死活选不中）。\n\n' +
          '关键机制都在这层：结果状态前缀、并发、去重、路由 eval——见下面二级架构。',
        code: {
          caption: 'base.py — Skill 抽象',
          body: `@dataclass(frozen=True)
class Skill:
    name: str
    description: str          # 给模型看：决定何时调、传什么参数（"何时用我"全靠它）
    parameters: dict         # OpenAI function-calling 的 JSON schema
    handler: SkillHandler    # async (session, args) -> str
    # readonly 自动放行 / write 有副作用需审批。新增 write skill 务必显式标，
    # 否则默认 readonly 会绕过权限闸自动执行。
    risk: Literal["readonly", "write"] = "readonly"
    # private=True 只在鉴权私有通道暴露（即便 readonly）。与 risk 正交：
    # risk 管"要不要审批"，private 管"哪条通道能看到"。
    private: bool = False`,
        },
        pitfall:
          '**别在 SYSTEM 里点名工具。** 曾经 SYSTEM 写死"先用 kb_search"，后果三连：① 每加一个 skill 就得改提示词' +
          '(O(n) 膨胀 + 打断 prompt cache 前缀)；② **description 形同虚设被覆盖**——新上线的 `kb_graph` 死活选不中，就是被那句' +
          '"先用 kb_search"压的；③ 提示词和注册表两处真相迟早不同步。\n\n' +
          '**教训**：SYSTEM 只讲策略("涉及本站内容先查知识库")，"何时用我"还给各 skill 的 description。' +
          '改完实测 kb_graph 一字未改描述就立刻被选中。加新 skill = 1 文件 + 1 行注册 + **0 行提示词**。',
        tech: ['Skill dataclass', 'risk 分级', '结果状态前缀', '并发 MAX=6', '归一化去重', 'SYSTEM 不点名'],
        children: [
          {
            id: 'tools-result',
            title: '结果状态语义',
            summary: '[无结果] / [出错] 前缀，让模型一眼分清"查了没有"和"工具坏了"。',
            concept: '模型（尤其较小的）容易把空结果当"该重试"→ 反复换措辞搜同一件事。给结果打自解释前缀是最省的解法。',
            implementation: `[results.py](${REPO}/apps/server/app/modules/skills/results.py)：\`empty()\`/\`error()\` 两个 helper，只前置不吞原文。`,
            code: {
              caption: 'results.py',
              body: `def empty(msg: str) -> str:   # 工具跑了、但没命中 → 别反复换措辞搜同一件事
    return f"[无结果] {msg}"

def error(msg: str) -> str:   # 工具本身失败(网络/依赖/超时) → 重试通常无用，换条路
    return f"[出错] {msg}"

# 成功不加前缀（最常见）；参数错/通道不可用那类"改你的调用"也不用它。
# kb_search 空 → return empty("知识库里没有相关内容。")
# web_fetch 挂 → return error(f"抓取失败：{e}")`,
            },
          },
          {
            id: 'tools-dedup',
            title: '收敛闸 _turn_cap',
            summary: '每轮检索归一化去重 + 硬上限，挡"换角度重搜"烧 token。',
            concept: '实测 agent 一个回合能搜 13 次高度重复的 query。精确去重抓不住换措辞，需归一化 + 总次数上限双保险。',
            implementation: '`_norm_query`（去标点空白）+ `MAX_SEARCHES_PER_TURN=6`；子代理另有上限 2。见 [service.py](' + REPO + '/apps/server/app/modules/agent/service.py)。',
            code: {
              caption: 'service.py — 检索去重 + 硬上限',
              body: `def _norm_query(q: str) -> str:            # "省显存?" 和 "省 显存" 归一成同一个
    return re.sub(r"[\\W_]+", "", q.lower())   # \\W 按 Unicode 判定，CJK 保留

def _turn_cap(name, args, state):          # 返回非 None = 拦下、用文案当结果、不真跑
    if name in _SEARCH_SKILLS:             # {"web_search", "kb_search"}
        q = _norm_query(str(args.get("query", "")))
        if q in state["searched"]:
            return "（这个查询本轮已经搜过了，别重复搜同一件事…）"
        if len(state["searched"]) >= MAX_SEARCHES_PER_TURN:   # = 6
            return "（本轮检索已达上限，别再搜了，用已有结果作答。）"
        state["searched"].add(q)
    return None`,
            },
            pitfall:
              '**实测一个回合能搜 13 次高度重复的 query。** 模型换个措辞就以为是"新搜索"——"大模型省显存?"、' +
              '"大模型 显存 优化"、"如何减少显存占用"，本质同一件事，白烧 token 又拖慢响应。\n\n' +
              '**教训**：光做精确去重不够(抓不住换措辞)。要 ① 归一化(去标点空白，让近似 query 归并) + ② 每轮**总次数硬上限**' +
              '兜底那些归一化也挡不住的"换角度重搜"。两道一起才收得住。',
          },
          {
            id: 'tools-parallel',
            title: '并发执行',
            summary: '同批无副作用工具并发，write 一律串行。',
            concept: '并行化省墙钟时间，但写操作并发会竞态——按风险决定能否并发。',
            implementation: '`MAX_PARALLEL_TOOLS=6`（对齐 Codex）；`is_parallel_safe` 只放行原生 readonly/控制类，write/MCP 串行。队列汇流，结果按原下标落库保 H1。',
          },
          {
            id: 'tools-eval',
            title: '路由金标准 eval',
            summary: '夜跑真模型断言"给定 query 首个工具选对没"。',
            concept: 'SYSTEM 去枚举后路由全靠描述，需要网兜防退化——这是把"凭手感调描述"变成"有数据守"的一跳。',
            implementation: `[test_live_skill_routing.py](${REPO}/apps/server/tests/test_live_skill_routing.py)：判定用"首轮工具集 ∩ 预期 非空"（模型爱批量搜，交集判定不误杀）。`,
          },
        ],
        sources: [
          { title: 'Writing effective tools for AI agents — Anthropic', url: 'https://www.anthropic.com/engineering/writing-tools-for-agents' },
        ],
      },
      {
        id: 'memory',
        title: '记忆 Memory',
        tag: 'owner 向量 · 去重 · 遗忘',
        core: true,
        summary: '跨会话记住 owner 的事实，让 agent "越用越懂你"——2026 把它当独立于上下文窗口的架构组件。',
        concept:
          '2026 的记忆已是**独立架构层**，不再等同于"上下文窗口"。典型分**working / episodic / semantic** 三类；记忆层负责**抽取事实 → 存进向量库**（按 user/session/agent 索引）→ ' +
          '用**语义相似 + 关键词 + 实体**混合召回。配套要有**去重、上限、遗忘/衰减**，否则记忆会越用越烂。',
        implementation:
          '本站 [`MemoryStore`](' +
          REPO +
          '/apps/server/app/modules/memory/store.py) 复用 kb 的 Embedder + pgvector，不另造检索：\n\n' +
          '- **写** `remember`：模型自判"跨会话仍成立的事实"时调，写前按 embedding 去重（余弦 < 0.12 更新而非新插），每 owner 上限 200 淘汰最旧。\n' +
          '- **召回** `recall`：每轮拿 query embed，取该 owner 距离 < 0.6 的 top-6，注入到缓存前缀之后。\n' +
          '- **遗忘** `forget`；owner 走 `current_owner` ContextVar 传（skill 签名不带 owner）。\n' +
          '- 前端有"记忆"面板可列/删。',
        tech: ['owner 维度', 'pgvector 向量召回', '写时去重', '上限淘汰', 'ContextVar 传 owner', '记忆注入'],
        children: [
          {
            id: 'memory-write',
            title: '写 remember + 去重',
            summary: 'embed → 最近一条距离 < 0.12 则更新，否则新插 + 超限淘汰。',
            concept: '写时去重是记忆不烂的关键：同一件事换个说法不该记第二遍。',
            implementation: `[store.py](${REPO}/apps/server/app/modules/memory/store.py) \`remember\`：\`DEDUP_DISTANCE=0.12\` / \`MAX_MEMORIES_PER_OWNER=200\`。`,
            code: {
              caption: 'store.py — remember 写前去重',
              body: `async def remember(self, owner, content):
    vec = await embedder.embed_one(content)
    near = (await self.session.execute(          # 该 owner 最近的一条
        select(AgentMemoryRow, AgentMemoryRow.embedding.cosine_distance(vec).label("dist"))
        .where(AgentMemoryRow.owner == owner, AgentMemoryRow.embedding.isnot(None))
        .order_by("dist").limit(1))).first()
    if near is not None and near.dist < DEDUP_DISTANCE:   # 0.12 → 同一件事
        near[0].content = content; near[0].embedding = vec   # 更新，不新插
        return "（已更新一条相近的记忆）"
    self.session.add(AgentMemoryRow(owner=owner, content=content, embedding=vec))
    await self._evict_over_cap(owner)            # 超 200 淘汰最旧`,
            },
            pitfall:
              '**不去重的记忆会越用越烂。** 用户说三次"我喜欢暗色"，naive 实现就存三条几乎一样的——召回时全挤进上下文当噪声，' +
              '还挤掉真正有用的记忆。\n\n' +
              '**教训**：写入是"upsert 语义"不是"append"。写前拿新内容的 embedding 找最近一条，够近(余弦<0.12)就**更新**那条、' +
              '不新插；再配每 owner 上限 + 淘汰最旧。记忆层的价值一半在检索、一半在**克制**。',
          },
          {
            id: 'memory-recall',
            title: '召回 recall + 注入',
            summary: 'query embed → owner 向量检索 → 阈值过滤 → system 备注注入。',
            concept: '召回位置很讲究：塞在稳定缓存前缀之后（同 summary/历史），不破 prompt cache。不相关的（距离超阈值）不注入，免当噪声。',
            implementation: '`RECALL_MAX_DISTANCE=0.6` / `RECALL_TOP_K=6`；注入在 [`_inject_memories`](' + REPO + '/apps/server/app/modules/agent/service.py)，失败吞掉不拖垮回答。',
            code: {
              caption: 'store.py + service.py — 召回并注入',
              body: `# store.py：owner 向量检索 + 距离阈值筛选
async def recall(self, owner, query, k=6):
    qvec = await embedder.embed_one(query)
    rows = (await self.session.execute(
        select(AgentMemoryRow.content,
               AgentMemoryRow.embedding.cosine_distance(qvec).label("dist"))
        .where(AgentMemoryRow.owner == owner)
        .order_by("dist").limit(k))).all()
    return [r.content for r in rows if r.dist < RECALL_MAX_DISTANCE]   # 0.6 太远不要

# service.py：注入在稳定缓存前缀之后（同 summary/历史动态区，不破 cache）
mems = await MemoryStore(session).recall(owner, q)
if mems:
    messages.append({"role": "system",
        "content": "[关于当前用户，你此前记住的]\\n" + "\\n".join(f"- {m}" for m in mems)})`,
            },
            flow: [
              '私有会话每轮开始：拿这轮用户问题 `q` 做 embedding。',
              '在该 owner 的记忆里按余弦距离 `<=>` 排序，取最近 `k=6` 条。',
              '**按距离筛**：只留距离 `< 0.6` 的——不相关的宁可不给，别当噪声塞进上下文。',
              '把留下的几条拼成一条 system 备注，`append` 到 messages——**位置在稳定缓存前缀之后**（同 summary/历史动态区），不破 prompt cache。',
              '召回**失败被 try/except 吞掉**：记忆是加分项，挂了也要正常作答，不能拖垮回答。',
            ],
          },
          {
            id: 'memory-owner',
            title: 'owner 隔离 & 传递',
            summary: '记忆只属私有通道 owner；skill 拿不到 owner 参数，用 ContextVar 解。',
            concept: 'skill handler 签名是 (session, args) 不带 owner——请求级环境上下文用 ContextVar 最省侵入。',
            implementation: '`current_owner: ContextVar`，`answer_stream` 每轮 set；公开通道无 owner → 无记忆、也读不到别人的。',
          },
        ],
        sources: [
          { title: 'State of AI Agent Memory 2026 — mem0', url: 'https://mem0.ai/blog/state-of-ai-agent-memory-2026' },
        ],
      },
      {
        id: 'security',
        title: '安全 / 权限 / 沙箱',
        tag: '双通道 · C2 审批 · bwrap',
        core: true,
        summary: '让 agent 能动手又不闯祸：结构化权限 + 人在环审批 + 强隔离执行。',
        concept:
          '一旦 agent 能写文件、跑命令，安全就是第一位。2026 的方向是**结构化权限**替代自然语言约束（"请不要 rm -rf"是靠不住的）：' +
          '工具带 risk 标签、按**工具组合**做风险分析、能力可验证。配套**人在环（HITL）审批**高危操作，以及**执行沙箱**（隔离文件系统/网络/进程）。',
        implementation:
          '本站四道防线叠加：\n\n' +
          `- **双通道能力暴露**（[permissions.py](${REPO}/apps/server/app/modules/skills/permissions.py)）：公开只给 readonly；私有才有 write/MCP。这是唯一的能力暴露点，纵深上 \`invoke\` 再拦一层（幻觉出高危名也拒）。\n` +
          '- **C2 审批**：write 工具暂停本轮、发 approval 事件、前端逐项批/拒后续跑。\n' +
          '- **Pi bwrap 沙箱**：file/shell/git 全在树莓派上 `bwrap --unshare-net --clearenv` 无特权隔离执行，系统只读、仅 workspace 可写、默认断网。\n' +
          '- **SSRF 守卫**：web_fetch 拒环回/私网/保留段。',
        pitfall:
          '**公开无鉴权端点一旦挂上 write/shell/MCP 工具，就是"谁都能 RCE"。** 而且 C2 浏览器点批准对公开端点等于' +
          '**攻击者自批自**——审批形同虚设。\n\n' +
          '**教训**：安全不能靠"审批弹窗"补，得从**能力暴露**根上切。所以拆两条通道：公开永远只看得到 readonly 非 private 工具，' +
          '写/沙箱/MCP 只在 TOTP 私有通道。`tools()` 是唯一暴露点、`invoke()` 再纵深兜底(幻觉出高危名也拒)。' +
          '还有个隐蔽坑：agent_token 若用**主密钥**签，`current_admin` 会把它当 admin token 放行 = 公开 TOTP 直接换全 admin 权限——所以用派生密钥。',
        tech: ['结构化 risk 分级', 'C2 人在环审批', 'bwrap 强隔离', 'SSRF 守卫', 'owner 隔离', '_AUTO_WRITE 免批例外'],
        children: [
          {
            id: 'sec-perm',
            title: '风险分级 requires_approval',
            summary: 'readonly/控制类免批，write 需审批；记忆写是"免批但串行"的例外。',
            concept: '权限判定要能表达"benign 的写"——记忆写有副作用但 owner 内部无害，不该弹审批却仍要串行。',
            implementation: '`_CONTROL`（update_plan/ask_user）+ `_AUTO_WRITE`（remember/forget）免批；后者不进 `is_parallel_safe`（dedup 读改写要串行）。',
            code: {
              caption: 'permissions.py',
              body: `_CONTROL = {"update_plan", "ask_user"}      # 控制流，无外部副作用
_AUTO_WRITE = {"remember", "forget"}        # 写自己的记忆：免批，但仍是 write

def requires_approval(name: str) -> bool:
    if name in _CONTROL or name in _AUTO_WRITE:
        return False
    skill = REGISTRY.get(name)
    if skill is not None:
        return skill.risk != "readonly"     # 原生 write 需批准
    if mcp_manager.has(name):
        return not mcp_manager.is_auto(name)  # 非 auto 的 MCP 需批准
    return False

def is_parallel_safe(name):                 # 能否与同批并发
    if name in _CONTROL: return True
    skill = REGISTRY.get(name)              # _AUTO_WRITE 是 write → 不在此，串行
    return skill is not None and skill.risk == "readonly"`,
            },
          },
          {
            id: 'sec-approval',
            title: 'C2 交互审批',
            summary: '高危工具暂停 → approval 事件 → 用户批/拒 → 续跑。',
            concept: '暂停时绝不能落 assistant(tool_calls)（会成孤儿毒化会话 H1），要暂存到 pending。',
            implementation: `pending(JSONB) 存 {content, tool_calls}，批准续跑才落库；拒的回"用户拒绝"结果。见 [service.py](${REPO}/apps/server/app/modules/agent/service.py)。`,
            flow: [
              '某轮模型发起 tool_calls，其中有 write 类(`requires_approval` 为真)。',
              '**暂停**：把 {content, tool_calls} 存进 `session.pending`(JSONB)，**不落 assistant 消息**(否则孤儿 tool_call 毒化会话)。',
              '发 `approval` 事件带 requests，本轮结束。前端渲染 ApprovalCard，用户逐项批/拒。',
              '前端带 `{approvals: {tool_call_id: bool}}` + session_id 重新 POST 续跑。',
              '此时才落 assistant(tool_calls)：拒的回"用户拒绝"结果、批的真执行，清 `pending`，续跑事件回填**同一轮**。',
            ],
          },
          {
            id: 'sec-sandbox',
            title: 'Pi bwrap 沙箱',
            summary: '真 Linux 上无特权隔离跑命令，比 Mac 强、比云 VM 省。',
            concept: 'agent 执行不可信代码必须隔离：文件系统只读、网络切断、环境变量清空（命令读不到 token）。',
            implementation: `[pi-agent/executor.py](${REPO}/apps/pi-agent/agent/executor.py)：\`--clearenv --unshare-net --chdir\` + 120s 超时 + 64KB 上限；无 bwrap 拒跑。传输走 HTTP 长轮询（Pi 装不上 wss）。`,
          },
        ],
        sources: [
          { title: 'awesome-harness-engineering — permissions & sandbox', url: 'https://github.com/ai-boost/awesome-harness-engineering' },
        ],
      },
    ],
  },
  {
    layer: 'orchestration',
    nodes: [
      {
        id: 'mcp',
        title: 'Skills & MCP',
        tag: '注册表 · 渐进披露',
        summary: '工具从哪来、怎么在"多到爆"时不撑爆上下文。',
        concept:
          '**MCP（Model Context Protocol）**是 2026 的工具接入事实标准，能给 agent 挂上百个外部工具。但工具一多，光 schema 就撑爆上下文——' +
          '于是有**渐进披露**：常驻的只是"名字 + 一句话"目录，完整 schema 用到才加载。',
        implementation:
          `本站 [REGISTRY](${REPO}/apps/server/app/modules/skills/registry.py) 顺序 = tools 顺序 = 缓存前缀（append-only）。MCP 走**渐进披露**：默认只给一个 \`load_tools\` 元工具（description 带轻目录、names 用 enum 钉死），模型 load 后完整 schema 才进本轮。实测完整 schema 均摊 276 tok/个 vs 目录项 97 tok/个 = 2.8 倍。**只对 MCP 不对原生**（原生 13 个全在缓存前缀里、成本≈0）。`,
        tech: ['MCP 协议', '渐进披露', 'load_tools + enum', 'append-only 注册'],
        children: [
          {
            id: 'mcp-registry',
            title: '注册表 = 缓存前缀',
            summary: 'REGISTRY 顺序 = tools 顺序 = prompt cache 前缀，只增不重排。',
            concept: '工具列表是缓存前缀的一部分——随机化/动态重排(如 MCP list_changed)会打断缓存。Codex 踩过这个坑。',
            implementation: `新 skill 一律追加到 [registry.py](${REPO}/apps/server/app/modules/skills/registry.py) 末尾，绝不插中间；MCP 工具按 (server,tool) 字典序确定性排序追加在原生之后。`,
          },
          {
            id: 'mcp-progressive',
            title: 'load_tools 渐进披露',
            summary: '常驻的只是"名字+一句话"目录，完整 schema 用到才加载。',
            concept: '工具一多，光 schema 就撑爆上下文。学 CC Skills：目录常驻、正文按需。只对 MCP 做(别人写的、数量不可控)，原生常驻(成本≈0、拆开反而更选不中)。',
            implementation: `默认只给 \`load_tools\` 元工具(description 带轻目录、names 用 enum 钉死防幻觉)，模型 load 后 schema 才进本轮 tools(每步重算)。实测 276 vs 97 tok/个 = 2.8 倍。[service.py](${REPO}/apps/server/app/modules/skills/service.py)`,
            code: {
              caption: 'service.py — load_tools 元工具（目录常驻、schema 按需）',
              body: `def _load_tools_schema(catalog):
    listing = "\\n".join(f"- {c['name']}：{c['description']}" for c in catalog)
    return {"type": "function", "function": {
        "name": "load_tools",
        "description": f"下列工具当前不可直接调用，需先加载：\\n{listing}",
        "parameters": {"type": "object", "properties": {"names": {
            "type": "array",
            "items": {"enum": [c["name"] for c in catalog]}}}}}}  # enum 挡"编个不存在的工具名"

# tools()：原生常驻在前；MCP 只给 load_tools + 已 loaded 的
return native + [_load_tools_schema(catalog)] + mcp_manager.tools_by_names(loaded)`,
            },
            flow: [
              '默认这轮 tools = 原生工具(全 schema，常驻) + 一个 `load_tools` 元工具(description 里带 MCP 的"名字+一句话"轻目录)。',
              '模型想用某个 MCP 工具 → 先调 `load_tools(names=[...])`(names 被 enum 钉死，编不出不存在的名)。',
              '把选中的名字记进 `turn_state["loaded"]`；`load_tools` 只是"翻开说明书"、不执行外部动作 → 免审批。',
              '**下一步循环重算 tools**：这次 `tools_by_names(loaded)` 把那几个 MCP 的完整 schema 加进来，模型可直接调。',
              '原生工具全程常驻在最前 → **核心缓存前缀不被打断**，只有真用到 MCP 的那一轮才破缓存。',
            ],
          },
          {
            id: 'mcp-timeout',
            title: '连接/调用超时',
            summary: 'MCP server 在 app lifespan 里连，一个 hang 住能让整站起不来。',
            concept: '接别人的进程要设边界：连接、列工具、调用各自超时，超时跳过该 server 而不是吊死整个应用。',
            implementation: '`_CONNECT_TIMEOUT=20s`(超时跳过、站照常起) / `_LIST_TIMEOUT=10s` / `_CALL_TIMEOUT=30s`，均可 env 覆盖。容器里没 node/npx，只能跑 Python 系 server 且需烘进镜像。',
            pitfall:
              '**MCP 在 app lifespan 里连，一个 hang 住(或首次要下依赖)的 server 就能让 FastAPI 永远起不来 = 整站挂。** ' +
              '接别人的进程，边界感必须拉满。\n\n' +
              '**教训**：连接/列工具/调用各自设超时，**超时跳过该 server 而不是吊死整个应用**。还踩过：容器是 Python uv 镜像没 node/npx→' +
              '官方 npx 系 server 根本跑不了；且 uvx 现拉依赖会因容器 FS 临时、PyPI 一慢就撞超时→**依赖必须烘进镜像**。',
          },
        ],
        sources: [
          { title: 'awesome-harness-engineering — Skills & MCP', url: 'https://github.com/ai-boost/awesome-harness-engineering' },
        ],
      },
      {
        id: 'orchestration',
        title: '编排扩展 / 子代理',
        tag: 'subagent · 并行',
        summary: 'orchestrator-workers：主代理把自包含子任务丢给子代理，隔离中间噪音。',
        concept:
          'Anthropic 的 **orchestrator-workers** 模式：一个中心 LLM 拆任务、派给 worker、综合结果——多文件改动、深度检索都靠它。' +
          '关键收益是**上下文隔离**：子任务的中间检索噪音不塞进主线。',
        implementation: `本站 [subagent.py](${REPO}/apps/server/app/modules/skills/subagent.py)：只读子代理（kb/web 检索），工具集**排除 run_subagent 自身**防递归、独立上下文不继承主对话、\`_SUB_MAX_STEPS=4\`、每轮上限 2 个。主代理侧把子代理每步当 tool_output 流给前端。`,
        tech: ['orchestrator-workers', '递归防护', '上下文隔离', '子代理上限'],
        children: [
          {
            id: 'orch-isolation',
            title: '递归防护 + 上下文隔离',
            summary: '子代理工具集排除自身防递归，独立上下文不继承主对话。',
            concept: 'orchestrator-workers 的核心收益是隔离——子任务的中间检索噪音不塞进主线。但要防子代理再开子代理无限套娃。',
            implementation: `子代理 \`stream_run\` 的工具集**排除 run_subagent 自身**，且只读(不碰 file/shell、免审批)、独立 messages 不继承主对话。[subagent.py](${REPO}/apps/server/app/modules/skills/subagent.py)`,
          },
          {
            id: 'orch-converge',
            title: '收敛闸',
            summary: '实测主代理会一口气开 4 个子代理、每个反复搜同一件事。',
            concept: '模型"过度勤奋"是真问题：不加闸会烧 token + 拖慢。要在编排层设上限。',
            implementation: '每用户轮 `MAX_SUBAGENTS_PER_TURN=2`、`_SUB_MAX_STEPS=4`、子代理内部 query 去重；超限的 tool_call 给提示不真执行。',
          },
          {
            id: 'orch-parallel',
            title: '并发汇流',
            summary: '同批 parallel-safe 工具并发跑，结果按原下标落库保 H1。',
            concept: '子代理/检索并发能省墙钟时间，但结果落库顺序必须和 tool_calls 对齐，否则 H1 配对断裂。',
            implementation: '`_execute_batch` 拆 `_exec_one`，并发/串行共用队列汇流(串行=limit 1)，`MAX_PARALLEL_TOOLS=6`；write 一律串行。',
          },
        ],
        sources: [
          { title: 'How we built our multi-agent research system — Anthropic', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' },
        ],
      },
      {
        id: 'planning',
        title: '规划 Planning',
        tag: 'update_plan',
        summary: '把多步任务拆成有序步骤并追踪进度。',
        concept: '**Plan-then-Execute**：先出计划再逐步执行，配可见的进度产物（planning artifact），长程任务不迷路。简单任务不该滥用。',
        implementation: `[update_plan.py](${REPO}/apps/server/app/modules/skills/update_plan.py)：event: plan 渲染终端 checklist，同时至多一个步骤 in_progress。`,
        tech: ['plan-then-execute', '进度产物', '控制类免批'],
        children: [
          {
            id: 'plan-checklist',
            title: '计划产物 event:plan',
            summary: '把步骤拆解流成前端可见的终端 checklist，同时至多一个 in_progress。',
            concept: 'planning artifact 让长程任务的进度对用户可见、对模型可追踪——不是内部黑箱。',
            implementation: `[update_plan.py](${REPO}/apps/server/app/modules/skills/update_plan.py)：steps[{content,status}]，service 拦成 event:plan。`,
          },
          {
            id: 'plan-restraint',
            title: '克制使用',
            summary: '简单单步问题不该滥用 plan。',
            concept: '规划有开销：给它明确"何时用"的边界，否则模型会给"1+1"也列个三步计划。',
            implementation: 'description 直接写"简单单步问题不要用"；它是控制类、免审批。',
          },
        ],
      },
      {
        id: 'rag',
        title: 'RAG / 知识',
        tag: 'kb_search · kb_graph',
        summary: '给模型外挂站内知识：块检索 + 概念图谱。',
        concept:
          '**Agentic RAG** 把传统"检索→生成"单次管线升级成带规划/反思/自纠的 agent 能力——模型自己决定要不要查、查几次、怎么综合。' +
          '检索侧趋势是**混合检索**（向量 + 关键词 RRF 融合）与**GraphRAG**（概念图谱补结构）。',
        implementation:
          `- \`kb_search\`：向量(bge-m3) + pg_trgm 双路 **RRF 融合，向量 2× 加权**（中文口语 query trigram 全是公共词噪声，等权会淹没正确文档）。\n` +
          `- \`kb_graph\`：LLM 抽的概念图谱，给"X 和 Y 什么关系"这类结构问题。\n\n代码：[kb/repository.py](${REPO}/apps/server/app/modules/kb/repository.py)`,
        tech: ['agentic RAG', '混合检索 RRF', 'GraphRAG', 'bge-m3 嵌入'],
        children: [
          {
            id: 'rag-hybrid',
            title: '混合检索 RRF 2:1',
            summary: '向量 + trigram 双路 RRF 融合，向量 2× 加权。',
            concept: '中文口语 query 走 trigram 只命中"大模型/模型"这类公共词、拿噪声分；等权融合会让泛文两票相加淹没正确文档。',
            implementation: `生产 57 篇实测：等权时"大模型怎么省显存"根本捞不到 FP4/vLLM 那几篇(向量单路其实排 4-6 位)。改 w_vec=2/w_fts=1 是甜点(再重会漏跨域噪声)。[repository.py](${REPO}/apps/server/app/modules/kb/repository.py)`,
            code: {
              caption: 'repository.py — 双路 RRF 融合（向量 2× 加权）',
              body: `WITH vec AS (        -- 向量路：cosine 最近 pool 条
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> :qvec) AS rank
  FROM kb_chunk c ... ORDER BY c.embedding <=> :qvec LIMIT :pool),   -- pool=40
fts AS (             -- trigram 路：word_similarity 最高 pool 条
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY word_similarity(:q, c.content) DESC) AS rank
  FROM kb_chunk c ... ORDER BY word_similarity(:q, c.content) DESC LIMIT :pool),
fused AS (
  SELECT id, SUM(score) AS rrf FROM (
    SELECT id, :w_vec * 1.0 / (:k + rank) AS score FROM vec    -- w_vec = 2.0
    UNION ALL
    SELECT id, :w_fts * 1.0 / (:k + rank) AS score FROM fts    -- w_fts = 1.0 (向量 2×)
  ) u GROUP BY id)                                             -- k = 60
SELECT ... FROM fused f JOIN kb_chunk c ... ORDER BY f.rrf DESC LIMIT :limit`,
            },
            flow: [
              '一个 query 同时走两路：**向量路**(query embedding 找 cosine 最近 40 块) + **trigram 路**(`word_similarity` 最高 40 块)。',
              '每路给命中的块一个**排名**(ROW_NUMBER)，不是原始分数——RRF 融合的是"名次"不是"分数"，避免两路量纲不可比。',
              '融合：每块得分 = `w_vec/(k+向量名次)` + `w_fts/(k+trigram名次)`，`k=60`。**向量权重 2×**。',
              '两路都命中的块拿两份分相加；只一路命中的拿一份。按融合分排序取 top-N 喂给 LLM。',
            ],
            pitfall:
              '**等权融合会让泛文淹没正确文档。** 中文口语 query 走 trigram 只命中"大模型/模型"这类公共词、拿 0.333 噪声分，' +
              '于是一堆泛泛的 AI 入门文两路都沾、**两票相加**反超"只有向量一票"的正确文档。\n\n' +
              '**实测**：问"大模型怎么省显存"，等权时根本捞不到 FP4/vLLM/推理优化那几篇——而向量单路其实把它们排在 4-6 位！' +
              '是 trigram 噪声把它们挤出了 top-8。**教训**：两路不是平等的，向量是主信号、trigram 是补充→给向量 2× 权重(实测的甜点，再重会漏跨域噪声)。',
          },
          {
            id: 'rag-graph',
            title: 'GraphRAG 概念图谱',
            summary: 'LLM 抽实体+关系织成图，给"X 和 Y 什么关系"这类结构问题。',
            concept: '文档级相似度织不出网(什么都跟什么像=毛球)；概念级才成立——同一概念跨文档合并成一个节点。',
            implementation: `两趟 JSON-mode 抽取(先实体、再把清单喂回问关系)，529 实体/499 关系。\`kb_graph\` skill 与 \`kb_search\`(块检索) 互补。发文后台自动增量抽。`,
          },
          {
            id: 'rag-embed',
            title: '嵌入与降级',
            summary: 'bge-m3(1024) 向量；未配 key 自动降级纯 trigram。',
            concept: '嵌入是外部依赖，要能优雅降级：没 key 时检索退到 pg_trgm(对中文友好)，功能不崩只是召回弱些。',
            implementation: 'OpenRouter bge-m3(走 Parasail 稳定)；`embedder.configured` 为假则 embedding 列留空、检索纯 trigram。记忆层复用同一 Embedder。',
          },
        ],
        sources: [
          { title: 'Context Engineering — RAG & Memory 2026', url: 'https://www.meta-intelligence.tech/en/insight-context-engineering' },
        ],
      },
    ],
  },
  {
    layer: 'reasoning',
    nodes: [
      {
        id: 'reasoning',
        title: '推理 Reasoning',
        tag: 'deepseek-reasoner',
        summary: '深度思考模式：换推理模型，把思维链流式展示。',
        concept: '**Reasoning models**（o1/R1 一类）把"想"显式化。工程上可按需切换：普通问题用快模型，难题切推理模型，并把 reasoning trace 展示出来（可解释）。',
        implementation: `顶栏"深度思考"开关 → 换 \`deepseek-reasoner\`，把 \`reasoning_content\` 实时流成可折叠"思考过程"块（不进正文/不落库）。实测 reasoner 仍支持 tools。见 [service.py](${REPO}/apps/server/app/modules/agent/service.py)。`,
        tech: ['reasoning model', '思维链流式', '按需切换'],
        children: [
          {
            id: 'reason-switch',
            title: '按需换推理模型',
            summary: '顶栏"深度思考"开关 → 换 deepseek-reasoner，普通问题仍用快模型。',
            concept: 'reasoning model 更强但更慢更贵——不该默认全开，做成用户可切的挡位，难题才上。',
            implementation: '`answer_stream(deep=True)` → `REASONER_MODEL`(env `KB_LLM_REASONER_MODEL` 可覆盖)；provider.stream_step 加 model 覆盖参。实测 reasoner 仍支持 tools，工具循环照常。',
          },
          {
            id: 'reason-trace',
            title: '思维链流式',
            summary: '把 reasoning_content 实时流成可折叠"思考过程"块，不进正文/不落库。',
            concept: '推理轨迹是可解释性资产：展示但隔离——它是"想"不是"答"，不该混进正文、也不该污染会话历史。',
            implementation: '解析 `delta.reasoning_content` → `reasoning` 事件；前端渲染可折叠块。鸡兔同笼实测 154 段思维链 + 干净答案。',
          },
        ],
      },
      {
        id: 'observability',
        title: '验证 / 可观测',
        tag: '分层测试 · live-smoke · eval',
        summary: '知道 agent 有没有变好、坏在哪——不是靠感觉。',
        concept:
          '**Evals & Observability** 是 harness engineering 的独立支柱：单元式断言、trajectory 评估、gate 部署、事件日志、决策审计。' +
          'agent 行为非确定，没有 eval 就是盲开。',
        implementation:
          '- **分层测试**：纯函数单测 + agent 循环 harness（脚本化 LLM，毫秒级）+ 夜跑 live-smoke（真 DeepSeek 守行为漂移）。\n' +
          '- **哨兵**：断言无 tool 结果含"执行失败"——曾因 mock 签名不匹配导致工具从没真跑、用例假绿三个月。\n' +
          `- **usage 事件**：每轮报输入/输出 token + 缓存命中率。代码 [tests/](${REPO}/apps/server/tests/)`,
        tech: ['分层回归网', 'live 冒烟', '路由 eval', '假绿哨兵', 'usage 遥测'],
        children: [
          {
            id: 'obs-layers',
            title: '分层回归网',
            summary: '纯函数单测 + agent 循环 harness(脚本化 LLM) + 夜跑真模型冒烟。',
            concept: '三层各司其职：单测毫秒级、harness 不联网测循环逻辑、live 守真模型行为漂移(不进 PR 门禁)。',
            implementation: `harness 用 ScriptedLLM 喂固定 rounds、断言 SSE 事件/消息配对/落库；live-smoke 每晚 UTC18:00 跑真 DeepSeek。[tests/](${REPO}/apps/server/tests/)`,
          },
          {
            id: 'obs-sentinel',
            title: '假绿哨兵',
            summary: '断言无 tool 结果含"执行失败"——防 mock 签名不匹配导致工具从没真跑。',
            concept: '最阴险的 bug 是"用例绿着但功能没跑"。曾因 harness 少收 privileged 参数，每次工具调用 TypeError 被吞成"执行失败"、不变量照样成立、假绿三个月。',
            implementation: '`_base_invariants` 断言 `not [r for r in rows if "执行失败" in r.content]`；工具优雅报错是"抓取失败/搜索失败"不含此标记、不误伤。建 cron 当晚就挖出来。',
            pitfall:
              '**最阴险的 bug 是"用例绿着但功能从没跑过"，假绿了三个月。** live 测试的 harness 把 fake invoke 直接 setattr，' +
              '但真签名是 `invoke(session, name, args, *, privileged)`——每次工具调用都 `TypeError`，被 `except Exception` 吞成' +
              '"skill 执行失败"喂回模型；模型照样答得出、不变量(no_leak/paired/done)全成立 → **绿灯，工具却一次没真跑**。\n\n' +
              '**教训**：① mock 签名必须和真实签名对齐，否则 except 会把 TypeError 吞成"功能正常降级"。② 加**哨兵断言**专门抓这种：' +
              '断言没有 tool 结果含"执行失败"。③ 洞是"套件从没人跑"才藏三个月的——建了夜间 cron 当晚就回本(18s→35s 证明工具真打网络了)。',
          },
          {
            id: 'obs-routing',
            title: '路由金标准 eval',
            summary: '夜跑断言"给定 query 首个工具选对没"，防 SYSTEM 去枚举后路由退化。',
            concept: '描述就是路由逻辑，但没东西盯着它——web_search 一轮搜 13 次那种退化是肉眼撞见的。要把它变成网兜。',
            implementation: `[test_live_skill_routing.py](${REPO}/apps/server/tests/test_live_skill_routing.py)：判定用"首轮工具集 ∩ 预期 非空"(模型爱批量搜，交集不误杀)。`,
          },
        ],
        sources: [
          { title: 'awesome-harness-engineering — Evals & Observability', url: 'https://github.com/ai-boost/awesome-harness-engineering' },
        ],
      },
      {
        id: 'infra',
        title: '基础设施',
        tag: 'DeepSeek · pgvector · Pi',
        summary: '底座：模型、嵌入、向量库、运行时。',
        concept: 'agent 不只是模型：还要向量库存记忆/知识、异步后端扛流式、隔离节点跑命令。选型受真实约束逼定（内存、出网、依赖）。',
        implementation:
          '- 生成 DeepSeek（deepseek-chat / -reasoner，直连）、嵌入 bge-m3（OpenRouter）。\n' +
          '- pgvector/pg16 存 kb_chunk / kb_entity / agent_memory 向量。\n' +
          '- FastAPI async + gunicorn(workers=1) + Docker Compose + Cloudflare Tunnel，部署阿里云小机（1.6G，有 OOM 前科，加东西都要量内存）。\n' +
          '- 树莓派当 bwrap 沙箱执行节点。',
        tech: ['DeepSeek', 'bge-m3', 'pgvector', 'FastAPI async', 'Cloudflare Tunnel', 'Raspberry Pi'],
        children: [
          {
            id: 'infra-model',
            title: '模型与嵌入',
            summary: 'DeepSeek(chat/reasoner) 直连生成 + OpenRouter bge-m3 嵌入。',
            concept: '生成和嵌入分开选型、各走 env 配置：都 OpenAI 兼容，换供应商不改代码。',
            implementation: 'CI 用一把独立的 KB_LLM_API_KEY(非生产那把)。关键事实：DeepSeek/OpenRouter 都无好用的通用 embedding 直连，故嵌入走 OpenRouter 的 bge-m3。',
          },
          {
            id: 'infra-store',
            title: 'pgvector 向量库',
            summary: 'pg16 + pgvector 存 kb_chunk / kb_entity / agent_memory 向量。',
            concept: '一个 pg 实例同时当关系库 + 向量库,省一套依赖。小语料精确扫描够用,hnsw 供规模变大再提速。',
            implementation: 'kb_chunk 建 hnsw 余弦索引;agent_memory 按 owner 过滤后量极小、不建 hnsw。检索用 `<=>` 余弦距离。',
          },
          {
            id: 'infra-deploy',
            title: '部署与隔离节点',
            summary: 'FastAPI async + Docker Compose + Cloudflare Tunnel;树莓派当沙箱。',
            concept: '小机(1.6G,有 OOM 前科)上加任何东西都要量内存;执行不可信代码放独立隔离节点(Pi bwrap),不放主机。',
            implementation: 'gunicorn workers=1、`pnpm deploy:server` rsync+docker 上阿里云;Pi 走 HTTP 长轮询回传(装不上 wss)。生产 530+SSH banner 超时+journald crash-loop = 内存不是磁盘。',
          },
        ],
      },
    ],
  },
];

// 扁平索引：按 id 找节点（下钻 / 面包屑用）。
export function findNode(id: string): ArchNode | undefined {
  const walk = (nodes: ArchNode[]): ArchNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(ARCH.flatMap((r) => r.nodes));
}
