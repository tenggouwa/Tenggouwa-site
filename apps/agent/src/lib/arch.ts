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
        tech: ['Skill dataclass', 'risk 分级', '结果状态前缀', '并发 MAX=6', '归一化去重', 'SYSTEM 不点名'],
        children: [
          {
            id: 'tools-result',
            title: '结果状态语义',
            summary: '[无结果] / [出错] 前缀，让模型一眼分清"查了没有"和"工具坏了"。',
            concept: '模型（尤其较小的）容易把空结果当"该重试"→ 反复换措辞搜同一件事。给结果打自解释前缀是最省的解法。',
            implementation: `[results.py](${REPO}/apps/server/app/modules/skills/results.py)：\`empty()\`/\`error()\` 两个 helper，只前置不吞原文。`,
          },
          {
            id: 'tools-dedup',
            title: '收敛闸 _turn_cap',
            summary: '每轮检索归一化去重 + 硬上限，挡"换角度重搜"烧 token。',
            concept: '实测 agent 一个回合能搜 13 次高度重复的 query。精确去重抓不住换措辞，需归一化 + 总次数上限双保险。',
            implementation: '`_norm_query`（去标点空白）+ `MAX_SEARCHES_PER_TURN=6`；子代理另有上限 2。见 [service.py](' + REPO + '/apps/server/app/modules/agent/service.py)。',
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
          },
          {
            id: 'memory-recall',
            title: '召回 recall + 注入',
            summary: 'query embed → owner 向量检索 → 阈值过滤 → system 备注注入。',
            concept: '召回位置很讲究：塞在稳定缓存前缀之后（同 summary/历史），不破 prompt cache。不相关的（距离超阈值）不注入，免当噪声。',
            implementation: '`RECALL_MAX_DISTANCE=0.6` / `RECALL_TOP_K=6`；注入在 [`_inject_memories`](' + REPO + '/apps/server/app/modules/agent/service.py)，失败吞掉不拖垮回答。',
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
        tech: ['结构化 risk 分级', 'C2 人在环审批', 'bwrap 强隔离', 'SSRF 守卫', 'owner 隔离', '_AUTO_WRITE 免批例外'],
        children: [
          {
            id: 'sec-perm',
            title: '风险分级 requires_approval',
            summary: 'readonly/控制类免批，write 需审批；记忆写是"免批但串行"的例外。',
            concept: '权限判定要能表达"benign 的写"——记忆写有副作用但 owner 内部无害，不该弹审批却仍要串行。',
            implementation: '`_CONTROL`（update_plan/ask_user）+ `_AUTO_WRITE`（remember/forget）免批；后者不进 `is_parallel_safe`（dedup 读改写要串行）。',
          },
          {
            id: 'sec-approval',
            title: 'C2 交互审批',
            summary: '高危工具暂停 → approval 事件 → 用户批/拒 → 续跑。',
            concept: '暂停时绝不能落 assistant(tool_calls)（会成孤儿毒化会话 H1），要暂存到 pending。',
            implementation: `pending(JSONB) 存 {content, tool_calls}，批准续跑才落库；拒的回"用户拒绝"结果。见 [service.py](${REPO}/apps/server/app/modules/agent/service.py)。`,
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
