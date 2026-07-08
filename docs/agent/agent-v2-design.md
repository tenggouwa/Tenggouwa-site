# apps/agent v2 设计:把内核对齐 Codex / Claude Code

> 前置调研:[docs/agent/agent-architecture-research.md](./agent-architecture-research.md)(两家逐层拆解 + 对比)。
> 本文档是那份调研的**落地版**——只挑对个人 KB agent 真正有用的 harness 模式,钉在本仓库真实代码上,给出表结构、消息装配、工具 schema、compaction 阈值与 PR 切分。
>
> 设计日期:2026-07-08。作者视角:apps/server 的 `agent`/`skills`/`kb` 三模块已上线(v1),前端 apps/agent 单轮问答已通。

---

## 0. 目标与非目标

**目标**:让 agent 内核在**长循环、多轮记忆、prompt 经济性、可规划性**四个维度与 Codex/Claude Code **同构**——即 harness 质量追平,剩余差距只是模型本身(DeepSeek vs GPT-5-Codex/Opus),那不是 harness 能补的。

**非目标(明确不做,抄了是负债)**:

| 他们有 | 为什么我们不做 |
|---|---|
| 五层 compaction pipeline | 单轮/短多轮用不上,一条摘要就够(见 §4) |
| OS 级沙箱(seccomp/Landlock/Seatbelt) | 后端受控环境,skill 不执行本机命令 |
| 无状态 ZDR(不用 `previous_response_id`) | 我们不受合规约束,有状态更省事更省 token |
| subagent 编排 | 规模化才需要,当前单 agent 足够 |

---

## 1. 现状与差距

当前实现([apps/server/app/modules/agent/service.py](../apps/server/app/modules/agent/service.py)):

```python
async def answer_stream(self, session, q):        # ← 无 session_id,单轮
    messages = [{"role":"system", "content":SYSTEM}, {"role":"user","content":q}]
    for _ in range(MAX_STEPS):                     # ← MAX_STEPS=4 硬上限
        msg = await chat_llm.complete(messages, tools=tools)
        ...                                        # ← 无持久化,无 compaction,无 plan
    async for delta in chat_llm.stream(messages): ...
```

| 维度 | 现状 | 目标(对齐两家) |
|---|---|---|
| 循环上限 | `MAX_STEPS=4` 硬卡 | 终止=模型不再 tool_call,兜底 max + token 预算(§1 调研) |
| 多轮记忆 | 无(每次全新) | append-only 会话 + resume(§5 调研) |
| prompt cache | 未刻意利用 | prefix 逐字节稳定 → DeepSeek 自动缓存命中(§9 调研) |
| 规划 | 无 | `update_plan` 工具写清单进上下文(§3 调研) |
| 工具 | 1 个(kb_search) | 少数"宽而少"可组合工具(§3 调研) |

四阶段按**依赖顺序**推进(前面是后面的地基):**P1 prompt cache 地基 → P2 多轮+持久化 → P3 长循环+规划 → P4 多工具+安全**。

---

## 2. P1 — prefix 稳定 + prompt cache(地基,零数据结构改动)

**原理**(调研 §9):朴素做法每 turn 全量重发 → 累计字节 O(n²)。DeepSeek API **自带上下文硬盘缓存**(Context Caching,无需配置):请求 prefix 与历史请求**逐字节一致**的部分自动命中,cache-hit token 计费仅为 miss 的约 1/10。我们唯一要做的是**保证 prefix 稳定**。

**消息装配铁律(静态在前、变动在后)**:

```
[0] system      ← 模块级常量 SYSTEM,永不变
    tools        ← 经 request 的 tools 参数传,顺序必须固定
[1..n] 历史消息   ← 只 append,不 insert、不 mutate
[n+1] 本轮 user   ← 最后
```

**具体动作**:
1. `SYSTEM` 已是模块级常量 ✓。确认它不拼时间/日期/随机内容。
2. **tools 顺序固定**:`skills_service.tools()` 遍历 `REGISTRY.values()`(Python dict 保插入序,稳定 ✓)。加注释锁死"REGISTRY 顺序即 cache 前缀,勿随机化"——这正是 Codex 踩过的 MCP `list_changed` 排序坑(调研 §9)。
3. **禁止在前缀里塞变动内容**:检索结果只以 `role:tool` 追加在**历史尾部**,绝不进 system。
4. **验证命中**:DeepSeek 的 `usage` 返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。在 `complete()` 里 `logger.info` 打这两个值,多轮对话时 hit 应随轮次上升。

**验收**:同一 session 第 2 轮起,`prompt_cache_hit_tokens > 0` 且随历史增长。成本近零,是放开步数(P3)的前提。

> 注:`complete()`/`stream()` 目前每次新建 `httpx.AsyncClient`——不影响缓存(缓存在服务端按内容匹配,与连接无关),但可考虑复用 client 省握手。非必须。

---

## 3. P2 — 多轮记忆 + 会话持久化

### 3.1 数据结构(与现有 kb_* 表同风格)

沿用 [models.py](../apps/server/app/db/models.py) 里 `KBSourceRow`/`KBDocumentRow` 的命名与 async 风格,新增两表:

```sql
-- agent_sessions:一次对话
id           text PK            -- 服务端生成(uuid4 hex),返回给前端持有
title        text NULL          -- 首个问题截断,列表展示用
summary      text NULL          -- compaction 产物(§4),压缩掉的旧轮浓缩
summarized_upto_seq int NOT NULL DEFAULT 0  -- 已被 summary 覆盖到的消息 seq
created_at   timestamptz NOT NULL
updated_at   timestamptz NOT NULL

-- agent_messages:append-only,一行一条消息
id           bigserial PK
session_id   text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE
seq          int NOT NULL        -- 会话内自增序,排序用
role         text NOT NULL       -- user | assistant | tool
content      text NOT NULL DEFAULT ''
tool_calls   jsonb NULL          -- assistant 轮的 tool_calls 原样存
tool_call_id text NULL           -- tool 轮回填对应的 call id
created_at   timestamptz NOT NULL
-- INDEX (session_id, seq)
```

**append-only**(对齐两家 §5):消息只插不改。assistant 的 `tool_calls` 和 tool 的结果都落库,resume 时能逐字节重建当时的 messages(保住 cache 前缀)。

alembic:新增 `20260708_xxxx_agent_sessions.py`。

### 3.2 service 签名变化

```python
async def answer_stream(self, session, q, *, session_id: str | None) -> AsyncIterator[dict]:
    sid = session_id or new_session_id()          # 无则新建,首个 event 回传 sid
    history = await repo.load_window(session, sid) # summary + summarized_upto_seq 之后的消息
    messages = [{"role":"system","content":SYSTEM}]
    if history.summary:
        messages.append({"role":"system","content":f"[早前对话摘要]\n{history.summary}"})
    messages += history.messages                    # 已按 seq 升序
    messages.append({"role":"user","content":q})
    await repo.append(session, sid, role="user", content=q)   # 先落用户轮
    ...  # tool-calling 循环(P3),每产出 assistant/tool 消息都 repo.append
    # 结束后落 assistant 最终答案
```

**首个 SSE event 回传 `session_id`**,前端存住,后续请求带上 → 多轮。

### 3.3 前端 apps/agent

- `Ask.tsx` 持 `const [sessionId, setSessionId] = useState<string|null>(null)`;请求 body 带 `session_id`;收到 `event: session` 时 `setSessionId`。
- 新开对话 = 清空 `sessionId` + `turns`。
- (可选)左侧列最近会话,点开 resume——先不做,P2 只保证同一页多轮连续。

---

## 4. P2 附带:极简 compaction(只做最顶层)

调研 §4:Claude Code 五层、Codex 一个加密端点——**我们都不做**,只做 Claude 第 5 层 auto-compact 的极简版:

- **触发**:load 出的历史 token 估算 > **阈值 T**(deepseek-chat 上下文 64K,取 `T = 24K` 留足输出与新问题余量)。token 估算用字节启发式(≈ 中文 1.5 char/token,英文 4 char/token,简单起见按 `len(text)/2`)。
- **动作**:把 `summarized_upto_seq` 之后、但保留**最近 K 轮**(K=6)之前的消息,喂给 `chat_llm.complete`(`max_turns` 概念不适用,单次调用)生成 ≤500 字摘要 → 写入 `sessions.summary`(与旧 summary 拼接再压)、更新 `summarized_upto_seq`。
- **保留尾部**:最近 K 轮原样留着(对齐 Claude "保留尾部最少 N 条")。
- **不做**:budget reduction / snip / microcompact / context collapse(调研 §4 的前四层)——单会话很难长到需要它们。

摘要 prompt 固定(利于它自己也吃 cache):`"把以下对话浓缩成不超过 500 字的要点,保留用户关注的实体、结论、待办。"`

> compaction 会一次性打断 cache 前缀(summary 变了),之后重新累积——这正是两家的行为,可接受。

---

## 5. P3 — 放开长循环 + 显式规划

### 5.1 循环重写

把 `for _ in range(MAX_STEPS)` 换成"**终止=模型不再 tool_call**,兜底防呆":

```python
MAX_STEPS = 16          # 兜底防死循环,不是常规上限(对齐两家"没有小硬上限")
STEP_TOKEN_BUDGET = 40_000   # 本轮累计 token 预算,超了强制收尾

for step in range(MAX_STEPS):
    msg = await chat_llm.complete(messages, tools=tools)
    tool_calls = msg.get("tool_calls") or []
    if not tool_calls:
        break                      # ← 正常终止:模型给纯文本
    # ... 执行、append、落库(同现状)
    if tokens_so_far() > STEP_TOKEN_BUDGET:
        messages.append({"role":"system","content":"预算已尽,请基于现有信息直接作答。"})
        break
```

### 5.2 update_plan 工具(抄 Codex `update_plan` / Claude TodoWrite)

新增一个 skill(注册进 `REGISTRY`),schema:

```json
{
  "name": "update_plan",
  "description": "把任务拆成有序步骤并更新进度。开始多步任务时先列计划,每完成一步更新状态。",
  "parameters": {
    "type": "object",
    "properties": {
      "plan": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "step": {"type": "string"},
            "status": {"enum": ["pending", "in_progress", "completed"]}
          },
          "required": ["step", "status"]
        }
      }
    },
    "required": ["plan"]
  }
}
```

- handler 不落 DB、不查外部,**只把 plan 原样回一句确认**(它的价值是把计划写进上下文,减少目标漂移)。
- 硬约束(抄 Codex):**同时至多一个 `in_progress`**;简单单步任务不要用 plan。写进 skill description。
- **SSE 单独发 `event: plan`**,前端渲染成终端 checklist:
  ```
  [✓] 查知识库拿资料
  [·] 综合三条命中作答      ← in_progress
  [ ] 补充相关链接
  ```
  极贴终端极客风,是这套 UI 的天然亮点。

---

## 6. P4 — 多几个"宽而少"的工具 + 安全红线

调研 §3:Codex 赌"给通用能力别给窄接口"。加 skill 遵循此原则:

- **候选**:`web_fetch`(抓 URL → 正文,只读)、`kb_browse`(按源/标签浏览,补 kb_search 的关键词盲区)。
- **不要**:kb_search / kb_reindex / kb_list / kb_stats 拆成四个——窄接口多了模型难选、prompt 长。
- **安全红线**(调研 §7):任何能执行代码 / 访问外部的 skill,handler 内必须白名单 + 超时 + 输出截断(参考 Codex `exec_command` 的 `max_output_tokens=10000` 截断、execpolicy 规范化判定)。`web_fetch` 保持**只读、域名白名单、响应大小上限**。

---

## 7. 数据结构与接口汇总

| 项 | 变化 |
|---|---|
| 表 | 新增 `agent_sessions` / `agent_messages`(§3.1);alembic migration |
| `agent/service.py` | `answer_stream(session, q, *, session_id)`;循环重写(§5.1);compaction(§4) |
| `agent/repository.py` | **新增**:`new_session_id` / `load_window` / `append` / `summarize`(仿 kb repository 风格) |
| `agent/router.py` | `POST /public/agent/chat` body 加 `session_id?`;SSE 增 `event: session` / `event: plan` |
| `skills/registry.py` | 注册 `update_plan`(§5.2);P4 再加 `web_fetch` 等 |
| `provider.py` | `complete()` 打 `prompt_cache_hit/miss_tokens` 日志(§2) |
| 前端 `Ask.tsx` | 持 `session_id`;渲染 `event: plan` checklist;新开对话按钮 |

---

## 8. PR 切分(每个独立可上线)

1. **PR-1 (P1)**:prefix 稳定注释 + cache 命中日志。零 schema 改动,纯验证。
2. **PR-2 (P2)**:两张表 + migration + repository + service 多轮 + 前端 session_id。**后端要 `pnpm deploy:server` + alembic upgrade。**
3. **PR-3 (P2补)**:极简 compaction(§4)。
4. **PR-4 (P3)**:循环放开 + `update_plan` skill + 前端 plan checklist。
5. **PR-5 (P4)**:`web_fetch` 等 + 安全约束。按需做。

每个 PR 走标准流程(feature branch → PR → ci 绿 → squash merge);带后端表/代码的 PR 合并后手动部署。

---

## 9. 风险与取舍

- **DeepSeek 缓存粒度**:官方缓存最小 64 token、按 prefix 匹配;若实测命中率低,回退方案是自己在应用层缓存不变前缀的 token 数无意义(缓存在服务端),只能确保 prefix 稳定——所以 P1 的注释纪律是硬要求。
- **公开无鉴权**:session 公开可读会泄别人对话。`session_id` 用不可猜的 uuid4;不做会话列表页(不给枚举入口);或加轻量 client fingerprint 绑定。**P2 落地前定**:先只做"同页多轮内存态 + 落库仅为 resume 自己",不暴露跨端 resume。
- **compaction 丢信息**:摘要有损;保留最近 K 轮原文兜底。
- **plan 工具滥用**:模型可能对简单问题也列计划 → description 里明确"单步任务禁用",实测调。

---

## 10. 一句话

做完 P1–P3,agent 内核在长循环、多轮记忆、prompt 经济性、可规划性上与 Codex/Claude Code **同构**;不做的三样(五层 compaction、OS 沙箱、无状态 ZDR)是它们为**自己的问题**付的税,不是我们的。关联:[[project_agent_app]] · [[project_kb]] · [docs/agent/agent-architecture-research.md](./agent-architecture-research.md)。
