---
slug: agent
title: Agent：从一次响应到一段"自主行动"
summary: AI 系列第 15 篇。tool use 让 LLM 能调一次工具。agent 让它能**自主规划 + 多步执行 + 自我纠正**。这一篇拆 ReAct、Plan-and-Execute、Tree of Thoughts、Reflexion 几个主流范式，并解释 2025-2026 年"agent"这个词为什么被严重滥用。
tags: [ai, agent, react, planning, ai-series]
published_at: 2026-06-05
---

> AI 系列第 15 篇。上一篇 LLM 学会"调用一次工具"，这一篇它学会"自主完成一整段工作"。
> 这一篇也会拆"agent"这个被滥用得最严重的词。

## 0. "Agent" 这个词被严重稀释了

2024 年起，每家公司发产品都喊自己是 "AI Agent"——

- 一个 ChatGPT wrapper？也叫 agent。
- 一个能调一个工具的 LLM 应用？也叫 agent。
- 一个真正能自主规划 + 多步执行 + 错误纠正 + 复杂任务完成的系统？也叫 agent。

**这些显然不是一回事**。这一篇我们把 agent 的真实层级讲清楚——并给一个能用的定义：

> **Agent = LLM 在一个循环里，能自主决定每一步该做什么，直到任务完成或失败。**

关键词：**循环**、**自主决定**、**多步**。

不在循环里 = 一次性调用 = 不是 agent。
不自主 = 每步都人指挥 = 不是 agent。
单步 = 工具调用 = 不是 agent。

---

## 1. 最基础范式：ReAct（2022）

**ReAct** = **Reasoning** + **Acting**。Google 2022 年提出。

工作流程：

```
loop:
    Thought: [LLM 想一下]
    Action: [LLM 决定调哪个工具]
    Action Input: [LLM 传参数]
    Observation: [工具返回结果]
    
    如果任务完成 → 输出最终答案，break
    否则 → 继续 loop
```

例子：

```
任务: "查找 Tenggouwa 这个域名的注册时间。"

Thought: 这需要查 whois。
Action: whois_query
Action Input: {"domain": "tenggouwa.com"}
Observation: {"created": "2024-01-15", "registrar": "Cloudflare"}

Thought: 找到了。
Final Answer: tenggouwa.com 注册于 2024-01-15。
```

ReAct 是所有 agent 的基础。它简单、有效、可解释。

### ReAct 的局限

- **短视**：只看当前步，不规划全局。
- **错误传播**：一步错满盘错。
- **重复**：可能在两个相似状态间来回跳。

为了解决这些，后续出现了几个变种。

---

## 2. Plan-and-Execute：先规划，再执行

**思路**：把任务拆成两阶段：

```
Planner:    "把任务拆成 5 个步骤"
Executor:   "按 Planner 的步骤逐个执行"
```

代码框架：

```python
# 阶段 1: 让强模型 (GPT-4) 先规划
plan = planner_llm.invoke(f"把这个任务拆成步骤: {task}")
# plan = ["1. 查 A", "2. 用 A 的结果查 B", "3. 整合"]

# 阶段 2: 让小模型 (GPT-4o-mini) 逐步执行
context = ""
for step in plan:
    result = executor_llm.invoke(f"执行步骤: {step}\n已有上下文: {context}")
    context += result
```

### 好处

- **全局视野**：先想清楚再做，避免局部贪心。
- **成本低**：规划用大模型，执行用便宜模型。
- **可调**：可以让人 review plan 再执行。

### 坏处

- **静态计划**：执行中遇到意外没法调整。
- **计划质量决定一切**：plan 错了，再多 step 也救不回来。

后续改进：**Plan-and-Solve**（每完成一步重新规划剩下的）、**ReWOO**（规划时不调工具，执行时统一调）。

---

## 3. Tree of Thoughts（ToT）：让 agent 探索多条路径

**2023 年**，普林斯顿团队提出 **Tree of Thoughts**。核心思想：

> 别只走一条路。让 agent 同时探索**多个想法分支**，评估每个分支的潜力，再决定深入哪条。

```
                  问题
                 /  |  \
            想法A 想法B 想法C
            /  \    |     \
         A1   A2   B1     C1
         评分7 评分3 评分8 评分5
         
         继续探索 B 这条分支
```

这有点像下棋——不止看下一步，还看下下步、下下下步。

### 适合的场景

- **创意任务**：写诗、起名字（一条路不一定好，多条路才能挑出妙的）
- **复杂推理**：数学证明、围棋（中间多步可能性多）

### 不适合的场景

- **简单任务**：太重，杀鸡用牛刀。
- **token 成本敏感**：每个分支都是一次 LLM 调用，分支多 = 钱多。

---

## 4. Reflexion：让 agent 从失败中学习

**2023** 论文。核心思想：

> agent 执行完一轮后，**反思**自己的表现，把反思结果存进 memory，下次同类任务时回顾。

```
attempt 1:  [执行 → 失败]
reflect:    "失败原因：忘了查参数 X。下次先查参数 X。"
            [反思存进 memory]
attempt 2:  [先查参数 X → 成功]
```

Reflexion 让 agent 在重复任务上能持续改进——这是 agent 走向"工程化生产"的关键一步。

---

## 5. Multi-Agent：多个 agent 协作

**2023 年起**的一个趋势——让多个 agent 扮演不同角色协作。

```
Architect:  "我设计一下整体方案"
Coder:      "我来写代码"
Reviewer:   "我审查代码"
Tester:     "我写测试"
```

代表：AutoGen（Microsoft）、CrewAI、Swarm（OpenAI）。

### 真有用还是花架子？

实测：**简单任务上 multi-agent 反而比单 agent 差**——通信开销大，agent 之间互相说服浪费 token。

**复杂任务**上（如完整 software project），multi-agent 有效，因为不同角色确实需要不同 prompt / 不同 expertise。

> 一句你可以拿去吹的话：
> **Multi-agent 不是更好的 agent，是另一种 agent。它适合任务结构本身就有多角色协作的场景，不适合所有问题。**

---

## 6. 现代生产级 Agent 通常长什么样

抛开理论，2026 年实际跑在生产的 agent 大概是这样：

```
loop with max_iterations=20:
    1. 把对话历史 + 当前状态喂给 LLM
    2. LLM 输出: 思考 + tool_call OR 最终答案
    3. 如果是 tool_call:
        a. 执行工具
        b. 把结果加进对话历史
        c. 继续 loop
    4. 如果是最终答案: break
    5. 如果达到 max_iterations: 强制终止，返回 partial result
```

关键工程点：

- **max_iterations**：防止 agent 死循环。常见 10-50。
- **error handling**：工具失败时，把错误返回给 LLM 让它纠正。
- **state checkpointing**：长任务中断后能续。
- **observability**：每一步都打 log / trace。
- **cost cap**：超过预算就停。

主流框架：
- **LangGraph**（LangChain 出品）：graph-based agent state machine
- **CrewAI**：multi-agent
- **OpenAI Swarm**：OpenAI 官方轻量级 agent
- **Anthropic Claude Agent SDK**：Anthropic 官方
- **AutoGPT / BabyAGI**：早期开源（现在基本退役）

---

## 7. Agent 能力的真实层级

我自己把现在的"agent"按能力分 5 级：

### L1: ChatBot
单轮 / 多轮对话，没工具。
例子：原版 ChatGPT 第一版

### L2: Tool-Augmented LLM
能调工具，但每次只调 1-2 个，主要还是对话。
例子：ChatGPT with browsing、Claude with retrieval

### L3: Workflow Agent
按预定义流程多步执行，但路径基本固定。
例子：客服自动化、订单处理

### L4: Goal-Driven Agent
给一个目标，自己规划路径、调工具、纠错，直到完成。
例子：Claude Computer Use、SWE-agent、Devin

### L5: Self-Improving Agent
能从经验里学习，持续改进。能跨任务 transfer。
例子：还没真正实现，但 Reflexion 系是这个方向

**今天 99% 商业产品是 L2-L3**。喊自己 L4 的，9 成是营销。真正能稳定跑 L4 任务的，目前只有几家前沿实验室的内部系统。

---

## 8. Agent 的难点：可靠性

agent 最大的工程问题不是"能跑通"，是"**能稳定跑通**"。

```
单次任务成功率: 80%
连续 5 步任务成功率: 0.8^5 = 33%
连续 10 步: 11%
连续 20 步: 1%
```

每步的小错误**指数级放大**。这就是为什么 agent demo 看起来惊艳，生产环境里 90% 的时间在调可靠性。

提升可靠性的几个手段：

1. **每步加 self-check**："这一步是不是真的成功？"
2. **关键步骤要 deterministic**：能用代码不用 LLM。
3. **缩短链长**：尽量把任务拆成 3-5 步而非 20 步。
4. **加 human-in-the-loop**：关键决策让人 review。
5. **专门 fine-tune**：对特定 agent 任务做后训练。

---

## 9. 给你的小作业

1. **找一个你日常会做的小任务（如"整理今天会议笔记并发邮件"），用 ReAct 范式写出 step-by-step。**
2. **解释为什么 ReAct 的成功率随步数指数下降。**
3. **如果你设计一个客服 agent，按什么样的能力分级（L1-L5）拆解？什么级别该上自己的产品？**

> **下一篇钩子**：要让 agent 真的好用，工具和模型之间要有标准协议。
> 2024 年底，Anthropic 发布了 **MCP（Model Context Protocol）**。2025 年 Agent SDK 系列陆续出现。
> 下一篇我们讲：今天构建 agent 的事实标准长什么样，以及 MCP 是不是"AI 时代的 HTTP"。
