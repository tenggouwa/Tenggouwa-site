# Codex vs Claude Code:Agent 架构逐层拆解与对比

> 调研日期:2026-07-08。目的:把当前两个最成熟的编码 agent(OpenAI **Codex** / Anthropic **Claude Code**)的内部架构挖到"每一层怎么实现"的程度,再做横向对比,最后落成对本仓库 `apps/agent` 的可借鉴清单。
>
> 取证来源分三类:
> - **一手**:`github.com/openai/codex`(Rust 源码 `codex-rs/`,含系统 prompt、工具 schema)、Anthropic 官方文档 `code.claude.com/docs` 与 `platform.claude.com`。
> - **半一手**:arXiv 论文 *Dive into Claude Code: The Design Space of AI Agent Systems*(2604.14228,逐行读了公开 minified TS,给出函数名/flag/文件名)。
> - **二手交叉验证**:ZenML LLMOps database、OpenAI 官方博客转述、PromptLayer / finisky / SWE Quiz / Daniel Vaughan / Jonathan Fulton 等深度拆解。
>
> 凡"公开资料未证实"处均明确标注,未编造。完整来源见文末 Sources。

---

## 0. 一句话结论

**两家的 agent 内核几乎一样:一个单线程 `while(有 tool_call){ 推理 → 执行工具 → 结果回填 }` 的 ReAct 循环,没有独立"规划引擎",agentic 行为从循环反复调用同一个 LLM + 累积 context 中涌现。** 真正拉开差距、也是 90% 工程量所在的,是围绕内核的那一圈系统:**上下文压缩、prompt cache 前缀稳定性、工具设计哲学、权限/沙箱、会话持久化与恢复、子 agent 委派**。

两家最大的**哲学分歧**:

| | Codex | Claude Code |
|---|---|---|
| 工具哲学 | **宽而少**:主力就是一个 `exec_command`(shell),模型自己用 `rg`/`sed`/`cat` 组合 | **多而专**:~54 个内置工具(对外精简为十几个),Read/Edit/Grep 各一个 |
| 上下文压缩 | **服务端一个 `/responses/compact` 端点**,返回带 `encrypted_content` 的不透明 blob(保住模型隐式记忆) | **客户端五层 pipeline**,从便宜到贵 lazy degradation |
| 状态 | **刻意无状态**(不用 `previous_response_id`),每次全量重发,满足 ZDR | 有状态,append-only JSONL session |
| 沙箱 | **内建 OS 级沙箱**(Seatbelt/Landlock/seccomp),默认禁网 | 权限系统 + ML 分类器为主,沙箱较轻 |

---

## 1. 核心循环(control flow)

**两家形态一致**:gather context → 调模型(流式)→ 若有 tool_call 则执行并 append 结果 → 再调模型 → 直到模型输出**纯文本、无 tool_call** 为止(唯一正常终止条件)。单条 user message 内部可触发**几十次**推理↔工具往返(Codex 例子 ~50 次)。

| 维度 | Codex | Claude Code |
|---|---|---|
| 循环实现 | Rust,`codex-rs/core`;typed **Item** 序列,每步 `item/started → delta → completed` | TS async generator,论文定位 `query.ts:queryLoop()`,逆向 codename **`nO`** |
| turn 定义 | 一次 input 提交 → 该 input 全部 output 产完;turn 中途可因审批暂停 | 官方:"one round trip";SDK 每阶段 yield `SystemMessage`/`AssistantMessage`/`UserMessage`/`StreamEvent`/`ResultMessage` |
| 终止条件 | 无 tool_call;系统 prompt 强调 "keep going until completely resolved"(偏长自治) | 无 tool_use block / `maxTurns`(仅计 tool-use turn)/ `maxBudgetUsd` / `prompt_too_long` / hook 置 `hook_stopped_continuation` / abort signal |
| 单线程? | 决策单线程;工具执行可并行(`tools/parallel.rs`) | 决策严格单线程、扁平 message list;只读工具并发、写工具串行;异步队列 codename **`h2A`** 支持中途插话(steering) |
| 错误处理 | 工具错不崩循环,`FunctionCallError::RespondToModel(...)` 把错误文本回灌让模型自纠;`responses_retry.rs` 管 API 重试 | tool 错误作为 tool_result 回灌;`MAX_OUTPUT_TOKENS_RECOVERY_LIMIT=3`;循环维护可变 `State`,有 7 个 "continue site",每个**整对象覆写**(为 append-only 审计与可恢复) |
| 最大轮数 | **无公开固定默认**;由 context/compaction + token budget(`rollout_budget.rs`)间接约束 | `maxTurns` 可配,命中返回 `error_max_turns` |

> **对 apps/agent**:你的 `MAX_STEPS=4` 是硬上限,两家其实**没有小的硬上限**——它们靠 compaction + budget 兜底,允许长自治。方向上应该放开步数,但前提是先解决 prompt cache(见 §9),否则长循环成本爆炸。

---

## 2. Prompt / message 结构 & 记忆层级

### Codex:四级 role + AGENTS.md

Responses API 请求三大字段:`instructions`(system/developer 级 base prompt,仓库里**按模型分文件**:`gpt-5.2-codex_prompt.md` 等)、`tools`、`input`(有序 item 序列)。

role 优先级递减:**system**(服务端注入,不可改)> **developer**(客户端:sandbox 权限说明、config.toml、base instructions)> **user**(AGENTS.md 聚合、环境上下文、真实输入)> **assistant**(模型历史)。

`input` 装配顺序(为 prompt cache 前缀稳定而设计,**静态在前变动在后**):
1. developer:sandbox 权限 + 可写目录
2. developer(可选):`~/.codex/config.toml`
3. user(可选):从 git root 向上聚合的 **AGENTS.md**
4. user:环境上下文(cwd/shell/OS/git)
5. user:真实输入

**AGENTS.md spec**(系统 prompt 一手):可在任意目录,scope=该目录子树,**更深层优先**;system/developer/user 直接指令**优先于** AGENTS.md;`AGENTS.override.md` > `AGENTS.md`;默认 **32 KiB** 上限。

### Claude Code:CLAUDE.md 5 层 + 关键点"CLAUDE.md 是 user message 不是 system prompt"

`getSystemContext()` 组装 system 上下文(含 git status);`getUserContext()` 把 CLAUDE.md 层级作为**一条 user message** 注入。**官方明确:"CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself"**——这解释了为什么 CLAUDE.md 是"强引导"而非"硬约束"。

CLAUDE.md 5 层(load order 越靠后=离 cwd 越近=优先级越高):

| Scope | 路径 | 谁改 |
|---|---|---|
| Managed policy(企业) | `/Library/Application Support/ClaudeCode/CLAUDE.md` 等 | IT,不可被个人 setting 排除 |
| User | `~/.claude/CLAUDE.md` | 你(所有 project) |
| Project | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 团队(随 VCS) |
| Local | `./CLAUDE.local.md`(gitignore) | 你(当前 project) |
| Auto memory | `~/.claude/projects/<p>/memory/MEMORY.md` | Claude 自己写 |

加载机制:**向上走目录树全部拼接**(非覆盖);cwd 下方子目录 CLAUDE.md **lazy-load**(读到该目录文件才注入);`@path` import 启动展开、**最多递归 4 hops**;`.claude/rules/` 带 `paths:` glob frontmatter 的按需 load;auto memory 只 load `MEMORY.md` **前 200 行 / 25KB**;HTML 注释 `<!-- -->` 注入前剥除省 token。

> **对比洞察**:两家都把"项目级指令"作为 **user 层内容**(而非 system),都靠**目录层级 + 深度优先**做 scope。Codex 更极简(单一 AGENTS.md 链),Claude Code 更精细(5 层 + rules + import + lazy-load)。**你的 `MEMORY.md` 机制正是抄的 Claude Code auto-memory**,方向对。

---

## 3. 工具系统(最大的哲学分歧)

### Codex:宽而少,一个 shell 打天下

工具以 Responses API function schema 定义(`ToolSpec::Function{name,description,strict,parameters,output_schema}`)。核心工具:

| 工具 | 作用 |
|---|---|
| **`exec_command`**(unified_exec)+ `write_stdin` | 在 **PTY** 里跑命令,主力工具 |
| `apply_patch` | 文件增删改(见下) |
| `update_plan` | TODO 计划 |
| `web_search` | 联网(默认 `"cached"`) |
| `spawn_agent`/`spawn_agents_on_csv` 等 | 子 agent(§6) |
| `mcp`/`mcp_resource` | MCP |
| `get_context_remaining`/`new_context_window` | 查/开上下文窗口 |
| `tool_search` | 动态延迟加载工具 |

**`exec_command` schema(一手 `shell_spec.rs`)关键默认值**:`cmd`(必填)、`yield_time_ms` 默认 **10000**(区间 250–30000)、`max_output_tokens` 默认 **10000**(这就是输出截断机制)、`tty`(bool 分配 PTY)、`login` 默认 true。

**apply_patch 补丁格式**(一手,系统 prompt 内嵌):
```
*** Begin Patch
*** Update File: path/to/file.py
@@ def example():
- pass
+ return 123
*** End Patch
```
三种操作头 `Add/Delete/Update File`;行前缀 ` `/`-`/`+`;**打完补丁禁止再读文件验证**(失败会自报错)。

`update_plan` 硬约束:**"At most one step can be in_progress at a time"**,每步 `{step, status: pending|in_progress|completed}`。

### Claude Code:多而专

经典 14 工具:**Bash / Glob / Grep / LS / Read / Write / Edit / MultiEdit / NotebookRead / NotebookEdit / WebSearch / WebFetch / TodoWrite / Task**。刻意用 **regex Grep 而非向量检索**。当前 SDK 已演进:File=Read/Edit/Write,Search=Glob/Grep,新增 **ToolSearch**(按需加载工具 schema,替代全量前置)、**Agent/Skill/AskUserQuestion/TaskCreate/TaskUpdate**。论文称源码里实为 **~54 个内置工具**、其中 35 个 feature-flag 条件工具。

工具走 `buildTool()` 工厂;每个带 `maxResultSizeChars`(budget reduction 用,Read 设 `Infinity`)、`readOnlyHint`。**并行规则**:只读工具(Read/Glob/Grep + read-only MCP)并发,写工具(Edit/Write/Bash)串行;`StreamingToolExecutor` 边流式边开跑,任一 Bash 报错触发 sibling abort。

> **对比洞察**:Codex 赌"模型足够强,给通用 shell 让它自己组合",接口面小 → 模型选择成本低、prompt 短。Claude Code 赌"专用工具更可控、可并行、可加 annotation(只读并发)"。**对 apps/agent 的启示**:你现在只有 1 个 skill(kb_search),扩展时**倾向少数几个能组合的工具,而非十个窄 API**(kb_search/kb_reindex/kb_list…)——窄接口多了模型反而难选。

---

## 4. 上下文管理 / compaction(实现路线完全不同)

### Codex:服务端一个端点 + 加密 blob

超过 `auto_compact_limit` 阈值(具体数值公开未证实,随 model context window 变)自动触发。策略=**摘要式,且有专用服务端端点 `/responses/compact`**:它返回一份更小的、可替换旧 input 的 item 列表,内含特殊 `type=compaction` item,携带**不透明 `encrypted_content` blob**——编码模型对整段对话的"latent understanding"(隐式记忆),而非明文摘要。ZDR 客户只存解密密钥不存明文。代码 `compact_remote_v2.rs` / `compact_token_budget.rs` / `compact_model_fallback.rs`(远端失败回退)。模型也能主动 `get_context_remaining` / `new_context_window`。

### Claude Code:客户端五层 lazy degradation

**每次模型调用前**顺序跑 5 个 shaper(`query.ts:365–453`),先便宜后贵:

| # | 层名 | 函数 / flag | 触发 | 作用对象 |
|---|---|---|---|---|
| 1 | **Budget reduction** | `applyToolResultBudget()` | 单条 tool result 超上限(逆向:>50K 字符写盘、留 ~2KB preview) | 单个超大工具输出;Read 豁免(阈值 Infinity) |
| 2 | **Snip** | `snipCompactIfNeeded()`,flag `HISTORY_SNIP` | 轻量时间裁剪 | 较老历史段 |
| 3 | **Microcompact** | flag `CACHED_MICROCOMPACT` | 管缓存开销;idle >60min 触发 time 路径 | 按 `tool_use_id` 删旧工具结果,用 server-side `cache_edits` **不失效缓存前缀** |
| 4 | **Context collapse** | `applyCollapsesIfNeeded()`,flag `CONTEXT_COLLAPSE` | 超长历史 | 折叠视图,summary 存 collapse store 不改历史 |
| 5 | **Auto-compact** | `compactConversation()` | 前四层跑完仍超压力阈值 | 整段对话语义压缩;先跑 `PreCompact` hook |

逆向补充:入口 `autoCompactIfNeeded()` 有 **circuit breaker(连续 3 次失败→跳过)**;阈值公式 **`context_window − max_output_tokens − 13K buffer`**;"free summaries"用后台 fork agent 全程 Edit 增量维护 markdown 笔记(**零额外 LLM 成本**);full compact 的 fork agent **共享主 session cache 前缀**降本;旧 codename 压缩器 **`wU2`**、触发点 ~92% 占用。

> **对比洞察**:Codex 把复杂度推给**服务端**(你只调端点,拿回加密 blob);Claude Code 把复杂度放在**客户端 pipeline**(可控、可调 flag、但工程量巨大)。**对 apps/agent**:单轮问答现在用不上 compaction;等你做**多轮对话记忆**时,最小可行版就是"超阈值时把旧轮次摘要成一条 system note"——即 Claude 第 5 层的极简版,不用做前四层。

---

## 5. 会话持久化与恢复

| | Codex | Claude Code |
|---|---|---|
| 存储 | `.jsonl` rollout 文件(`recorder.rs`),存 `$CODEX_HOME`(默认 `~/.codex`);另有 **SQLite** 索引层(`state_db.rs`/`session_index.rs`) | append-only JSONL(`sessionStorage.ts`);全局 `history.jsonl`;subagent 用 sidechain 独立文件 |
| 状态模型 | **刻意无状态**:不用 `previous_response_id`,每次全量重发满足 ZDR;`disable_response_storage` | 有状态;7 个 continue site 整对象覆写保 append-only |
| resume/fork | thread lifecycle:**create/resume/fork/archive**;CLI `codex resume`、`codex fork --last`;`session_startup_prewarm.rs` 预热 | `conversationRecovery.ts`:resume 从 transcript 重建 state、continue 续最近、fork 分叉;`--resume`/`--continue` |
| 恢复限制 | — | **session-scoped 权限在 resume/fork 时不恢复**(刻意安全设计) |

> **对比洞察**:Codex 无状态是为**合规(ZDR)**倒逼出来的,副作用是强依赖 prompt cache(§9)。两家都用 **JSONL append-only** 存会话——和你 `agent-<id>.jsonl` / 本仓库 journal 思路一致。

---

## 6. 子 agent 委派与并行

**两家都有 subagent,但形态不同**:

| | Codex | Claude Code |
|---|---|---|
| 定义 | 内建工具 `spawn_agent`/`send_input`;批量 `spawn_agents_on_csv`(按 CSV 每行 spawn worker,模板带 `{column}`,必须 `report_agent_job_result` 回 JSON,**阻塞至全部完成**) | `.claude/agents/*.md`(frontmatter:name/description/tools/model/permissionMode/isolation…);模型按 `description` 决定委派 |
| 上下文隔离 | 子 agent 独立 context + 沙箱,默认继承父 model | **独立 context window**,只拿自己 system prompt + cwd,**看不到父对话轮次**;`isolation:worktree` 给 repo 隔离副本 |
| 回传 | worker 结果按 `output_schema` 汇总导出 CSV | **只回传 final response 一条**作为 tool_result,不含子 transcript |
| 并行/深度上限 | `agents.max_threads` 默认 **6**、`agents.max_depth` 默认 **1**(默认禁套娃) | subagent **不能再派生 subagent**;codename `I2A`;`bubble` 模式把子权限请求 escalate 给父 |

> **对比洞察**:两家都用 subagent 做**上下文隔离**(脏活不污染主线程,只回摘要)——这正是本仓库 Workflow/Agent 工具在用的模式。**对 apps/agent**:短期用不上,但如果将来 agent 要"读一大堆知识库文档再综合",可以让一个子调用去做检索+初筛,只回结论。

---

## 7. 权限 / 安全 / 沙箱(Codex 更重 OS 级隔离)

### Codex:内建多平台 OS 沙箱

- **approval 模式**(`approval_policy`):`untrusted` / `on-request` / `on-failure` / `never`。
- **sandbox 模式**(`sandbox_mode`):`read-only`(默认最严)/ `workspace-write` / `danger-full-access`。CLI `--full-auto` = workspace-write + 低打扰;`--dangerously-bypass-approvals-and-sandbox`(旧 `--yolo`)= 全关。
- **平台实现**:macOS **Seatbelt**(`sandbox-exec` + `.sb`);Linux **Landlock + seccomp**(`landlock.rs`、`linux-sandbox` crate、bubblewrap);Windows `windows_sandbox.rs`。
- **网络默认禁**;`network_proxy` crate 控代理放行。
- **危险命令拦截**:`execpolicy`(规则判定 canonical 命令)+ `command_canonicalization.rs`(先规范化防绕过)+ `guardian/` 模块 + `safety.rs`。**只有自带工具走沙箱,MCP 工具不沙箱**。

### Claude Code:7 权限模式 + ML 分类器

`default` / `plan`(绝不自动批编辑)/ `acceptEdits`(自动批编辑+常见 fs 命令)/ `auto`(**ML 分类器**逐 call 判,flag `TRANSCRIPT_CLASSIFIER`,`yoloClassifier.ts`)/ `dontAsk` / `bypassPermissions`(root 下禁用)/ `bubble`(内部,子→父 escalate)。

allow/deny 规则 **deny-first**(deny 永远优先);支持 content 级 `Bash(npm *)` 匹配;MCP server 级 deny。**hooks 参与权限流**:`PreToolUse` 可返回 `permissionDecision:deny/ask` + `updatedInput` 直接拦截或改写。

> **对比洞察**:Codex 用**真 OS 沙箱**(seccomp/Landlock/Seatbelt)做硬隔离,默认禁网;Claude Code 更靠**权限规则 + ML 分类器 + hooks**做软控制。前者更适合"全自动跑不看着",后者更适合"人在环上确认"。**对 apps/agent**:你的 skill handler 跑在后端受控环境、无本机命令执行,当前不需要沙箱;但**skill 若将来能执行任意代码/访问外部,必须加白名单/审批**——参考 Codex execpolicy 的"规范化后按规则判"。

---

## 8. 模型交互

| | Codex | Claude Code |
|---|---|---|
| API | Responses API(`chatgpt.com/backend-api/codex/responses` 或 `api.openai.com/v1/responses`);payload `{instructions,tools,input,model}`,不带 `previous_response_id` | Messages API;`deps.callModel()` 传 messages+system+thinking+tools+abort+model |
| 流式 | SSE typed 事件(`response.output_text.delta` 等)→ 内部 Item | `for await` 流式 yield `StreamEvent`/`Message` 等 |
| reasoning | `model_reasoning_effort` ∈ `minimal|low|medium|high|xhigh`;reasoning item 持久化进 rollout **并跨工具往返带回**(推理连续性) | extended thinking 产可见 CoT;`effort`(low…max)与 thinking **独立**可组合 |
| 结构化输出 | 工具 schema `strict` + `output_schema`(如 `spawn_agents_on_csv` 要求 worker 匹配 schema) | tool_use/tool_result 标准协议 |

> **对比洞察**:Codex 的 reasoning token **跨工具往返保留**是它相对普通 Chat Completions 的关键优势;你用 DeepSeek 目前拿不到这个(除非 DeepSeek 支持 reasoning content 回传)。

---

## 9. Prompt caching / 性能(长循环的地基,两家都是头等约束)

**共同问题**:朴素做法每 turn 全量重发 → 累计发送字节 **O(n²)**(turn 50 可达数百万 token)。

**共同解法**:前缀 prompt caching 把 O(n²) 摊成近似 **O(n)**。

| | Codex | Claude Code |
|---|---|---|
| 机制 | Responses API 对**共享 exact prefix**的请求复用计算;Codex **只 append 不 rebuild** | 跨 turn 不变内容自动缓存:**system prompt / tool definitions / CLAUDE.md** |
| 铁律 | **cache key = 前缀逐字节一致**,静态在前变动在后;**任何靠前改动 poison 整个后缀** | 只首个请求付完整前缀成本 |
| 真实坑 | MCP `tools/list_changed` 导致工具数组**排序不定** → cache 全 miss;修复=定序(`session_prefix.rs`) | tool search 关闭 / 非一方 base URL 时 MCP schema 全量前置,吃光上下文 |
| 与 compaction 耦合 | compaction 也设计成尽量不动前缀 | microcompact 用 server `cache_edits` 删除**不失效前缀**;full compact fork 共享前缀 |

> **对 apps/agent 的最关键一条**:你现在每轮把 messages 重发给 DeepSeek。**DeepSeek 官方 API 原生支持上下文硬盘缓存**(命中的 input token 打骨折价)。要吃到它,必须保证**前缀逐字节稳定**:SYSTEM_PROMPT / tools schema 放最前且不变,检索到的 chunk / 用户问题放最后。这是"放开步数做长循环"的前提,否则成本爆炸。

---

## 10. 扩展性

### Codex

- **MCP 一等公民**(`mcp.rs`);Codex 自身也能作为 MCP server 跑。
- **config**(`config.toml`,`$CODEX_HOME`):`model` / `approval_policy` / `sandbox_mode` / `model_reasoning_effort` / `agents.max_threads`(6)/ `mcp_servers` 等;**profiles** 整套切换。
- **hooks**(`hook_runtime.rs`,`requirements.toml` 可 `allow_managed_hooks_only`)、**plugins**(模型可 `request_plugin_install`)、**skills**(`skills.rs`)、**connectors**、**memories**(跨会话记忆)。

### Claude Code:四机制分工清晰

| 机制 | 定义 | 触发 | 定位 |
|---|---|---|---|
| **MCP** | `.mcp.json`,工具名 `mcp__server__tool` | 调该工具时,schema 默认 deferred 按需 load | 接**外部服务**,跨进程协议 |
| **Skills** | `.claude/skills/<name>/SKILL.md`(YAML frontmatter) | **description 启动 load(短),body 用时才 load**(progressive disclosure) | 提供**指令/流程/知识**;custom commands 已并入 |
| **Hooks** | `settings.json` 的 `hooks`,matcher+command | 生命周期固定点(27 种 event) | **确定性 shell 拦截**,不占上下文,强制执行 |
| **Plugins** | `.claude-plugin/plugin.json` + `skills/`/`commands/`/`agents/`/`hooks/` | 安装即启用全部组件 | **打包分发**上述三种 |

一句话:**MCP 给新工具;Skills 给新流程/知识;Hooks 给确定性拦截;Plugins 打包分发。**

> **对比洞察**:两家都在收敛到"**skills = 渐进披露的能力**"(description 常驻、body 按需)。**你的 `apps/server/modules/skills` 注册表正是这个方向的最小版**——目前 skill 的 description 进 tools schema(给模型选),handler 是 body(调用时执行)。可以继续沿 Claude skills 的 progressive disclosure 演进。

---

## 11. 对 `apps/agent` 的落地借鉴(按性价比排序)

当前状态:单轮问答,`MAX_STEPS=4` tool-calling loop,1 个 skill(kb_search),无多轮记忆,无 prompt cache 复用。架构内核和两家**没有代差**,只是工具和规模小一号。下一步按收益排:

1. **【地基,先做】确认 DeepSeek prompt cache 生效** —— SYSTEM_PROMPT + tools schema 放消息最前且逐字节稳定,检索 chunk + 用户问题放最后。这是放开步数的前提(§9)。成本几乎为零,收益最大。

2. **【高收益】多轮对话记忆** —— 把上一轮 Q/A 带进 messages。最小可行:超 token 阈值时把旧轮摘要成一条 note(= Claude Code 第 5 层 auto-compact 的极简版,不用做前四层)(§4)。

3. **【中收益】显式规划** —— 若将来串多个 skill(kb_search → web_fetch → 汇总),抄 Claude 的 TodoWrite / Codex 的 update_plan:让模型先写步骤清单进上下文,减少长链路目标漂移(§3)。低成本。

4. **【扩展时的原则】工具"宽而少"** —— 加 skill 时倾向少数可组合的通用工具,别做十个窄 API(§3)。

5. **【规模化才需要】子 agent 隔离** —— 若 agent 要"读一大堆文档再综合",让子调用做检索+初筛只回结论,脏活不污染主上下文(§6)。

6. **【安全红线】skill 若能执行代码/访问外部,必须白名单+审批** —— 参考 Codex execpolicy"规范化后按规则判"(§7)。

**不用抄的**:五层 compaction(单轮/短多轮用不上)、OS 级沙箱(后端受控环境无本机命令执行)、无状态 ZDR(你不受合规约束,有状态更省事)。

---

## Sources

### Codex
- [Unrolling the Codex agent loop — OpenAI](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [Harness engineering — OpenAI](https://openai.com/index/harness-engineering/)
- [Unlocking the Codex harness (App Server) — OpenAI](https://openai.com/index/unlocking-the-codex-harness/)
- [Codex CLI Architecture and Agent Loop Design — ZenML LLMOps DB](https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design)
- [Building and Scaling Codex — ZenML LLMOps DB](https://www.zenml.io/llmops-database/building-and-scaling-codex-openai-s-production-coding-agent)
- [Inside the Codex Agent Loop — Daniel Vaughan](https://codex.danielvaughan.com/2026/03/28/codex-agent-loop-deep-dive/)
- [How OpenAI built Codex — SWE Quiz](https://www.swequiz.com/articles/openai-codex-architecture)
- [Inside the Agent Harness: Codex and Claude Code — Jonathan Fulton](https://medium.com/jonathans-musings/inside-the-agent-harness-how-codex-and-claude-code-actually-work-63593e26c176)
- [Codex CLI / Config Reference — OpenAI Developers](https://developers.openai.com/codex/config-reference)
- [github.com/openai/codex — `prompt_with_apply_patch_instructions.md`](https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md)
- [github.com/openai/codex — `tools/handlers/shell_spec.rs` / `plan_spec.rs` / `multi_agents_spec.rs`](https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/handlers)
- [github.com/openai/codex — `rollout/src/recorder.rs` & `policy.rs`](https://github.com/openai/codex/tree/main/codex-rs/rollout/src)
- [github.com/openai/codex — `codex-rs/core/src/`(landlock/windows_sandbox/exec_policy/compact_remote_v2/hook_runtime)](https://github.com/openai/codex/tree/main/codex-rs/core/src)

### Claude Code
- [Dive into Claude Code (arXiv 2604.14228)](https://arxiv.org/html/2604.14228v1) · [abstract](https://arxiv.org/abs/2604.14228) · [GitHub VILA-Lab/Dive-into-Claude-Code](https://github.com/VILA-Lab/Dive-into-Claude-Code)
- [How the agent loop works — Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Memory / CLAUDE.md — Claude Code Docs](https://code.claude.com/docs/en/memory)
- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Create plugins — Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Behind-the-scenes of the master agent loop — PromptLayer](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)
- [Context Compaction: A Five-Layer Cascade — Finisky Garden](https://finisky.github.io/en/claude-code-context-compaction/)
- [Single-Threaded Master Loop — ZenML LLMOps DB](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding)
- [Automatic context compaction — Claude Cookbook](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction)

### 对比
- [How OpenAI Codex Works (and How It Compares to Claude Code) — PromptLayer](https://blog.promptlayer.com/how-openai-codex-works-behind-the-scenes-and-how-it-compares-to-claude-code/)
