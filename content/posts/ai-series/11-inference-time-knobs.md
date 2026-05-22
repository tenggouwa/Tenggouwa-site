---
slug: inference-time-knobs
title: 推理时优化：temperature、top-p、CoT、structured output
summary: AI 系列第 11 篇。模型训完了，调用时还有一堆"旋钮"——temperature、top-p、思维链、structured output、reasoning effort。这一篇把这些参数怎么影响输出讲清楚，并对比 reasoning model (o1/Claude thinking) 和普通模型在用法上的本质区别。
tags: [ai, inference, temperature, cot, reasoning, ai-series]
published_at: 2026-06-01
---

> AI 系列第 11 篇。模型训练那 99% 的钱我们前几篇讲完了。
> 这一篇讲剩下 1%——**调用时**的旋钮。这些旋钮决定了同一个模型能给你三种完全不同的输出。

## 0. 同一个模型，三种性格

```
prompt: "写一个 0-100 之间的随机数"

temperature=0.0:  "42"           ← 总是一样
temperature=0.7:  "73"  / "28"   ← 有点变化
temperature=1.5:  "8128" / "?"   ← 完全胡来
```

同样的模型，同样的 prompt。换个数字，行为天差地远。这是 LLM 用户最先撞到的坑——**模型不仅由训练定义，也由调用参数定义**。

今天讲这些参数的本质。

---

## 1. 采样原理：模型输出一个概率分布，不是一个词

回忆一下：LLM 在每一步输出的是 **下一个 token 的概率分布**。

```
prompt: "今天天气真"
模型输出:
  "好"   60%
  "不错" 20%
  "差"    8%
  "棒"    5%
  ...
```

但用户最终看到的只有一个 token。**怎么从概率分布里挑一个？** 这就是采样（sampling）策略。

最朴素的策略：**贪心**（greedy）—— 永远选概率最高的。但这有两个问题：

- **输出僵硬**：永远一样的回答。
- **容易陷入循环**：模型生成 "好"，然后下一步又最可能 "好"，再下一步又 "好"... → "好好好好好"。

所以需要更聪明的采样。

---

## 2. Temperature：把分布"压平"或"拉尖"

`temperature` 控制概率分布的形状。

```
原始 softmax: p_i = exp(logit_i) / Σ exp(logit_j)
带温度的:     p_i = exp(logit_i / T) / Σ exp(logit_j / T)
```

直觉：

- **T = 1.0**：原始分布
- **T → 0**：分布变尖锐，几乎肯定选最高概率（≈ greedy）
- **T → ∞**：分布变平坦，几乎随机

```
原始分布 (T=1):    "好" 60%  "不错" 20%  "差" 8%  ...
低温 (T=0.3):      "好" 95%  "不错"  4%  "差" 0.5% ...    ← 集中
高温 (T=1.5):      "好" 35%  "不错" 20%  "差" 15% ...     ← 分散
```

### 实际选 temperature 的经验

| 任务 | 推荐 T | 原因 |
|---|---|---|
| 写代码 | 0.0–0.3 | 要确定性 |
| 翻译 / 总结 | 0.3–0.7 | 略有变化但保留语义 |
| 创意写作 | 0.7–1.0 | 要多样性 |
| 头脑风暴 | 1.0–1.5 | 要意外 |
| 故意搞怪 | 1.5+ | 看着玩 |

**一个调参口诀**：模型像在做 deterministic 的任务（代码、数学、事实），T 低。模型像在做开放性任务（写诗、聊天），T 高。

---

## 3. Top-p / Top-k：截断"长尾"

光调 temperature 还不够。即使 T 适中，模型也可能采到一个 1% 概率的奇怪 token，毁掉整个回答。

**Top-k**：只在概率最高的 k 个 token 里采样。

```
k=5: 只看前 5 个 token，剩下的全部置 0
```

简单但太粗。如果前 3 个 token 占了 99% 概率，但 k=10，你还是会去采那些不重要的。

**Top-p**（也叫 **nucleus sampling**）：选累计概率达到 p 的最小集合。

```
p=0.9: 把 token 按概率排序，累计到 90% 为止，从这些里采。

case A: 模型很确定
  "好" 90% → 累计就 90% 了，只在 ["好"] 里采。

case B: 模型不太确定
  "好" 30%, "不错" 25%, "棒" 20%, "差" 10%, "晴" 5% → 累计 90%, 从这 5 个采。
```

**top-p 比 top-k 优雅**——它自适应。模型确定时只在少数 token 选，模糊时多给一些备选。

### Temperature × Top-p 怎么配？

通常二选一就够。大多数 API 默认：

```
temperature = 1.0
top_p = 1.0  (即不截断)
```

OpenAI 文档说不建议两个一起调。常见配方：

- 严肃任务：`temperature=0.0`（一票否决）
- 一般对话：`temperature=0.7`
- 创意任务：`temperature=0.9, top_p=0.95`

---

## 4. Chain-of-Thought（CoT）：让模型"先想再答"

**2022 年**，Google 团队发了 *Chain-of-Thought Prompting* 论文。核心发现：

> 如果让模型在给最终答案之前**先输出推理过程**，准确率会大幅提升。

```
直接回答:
  Q: "罗杰有 5 个网球。他买了 2 罐网球，每罐 3 个。他现在有多少个网球？"
  A: "11" ← GPT-3 经常答错（说 8 或 17）

CoT 回答:
  Q: 同上
  A: "罗杰原来有 5 个。买了 2 罐 × 3 个/罐 = 6 个。所以共 5 + 6 = 11 个。"
  
  GPT-3 用 CoT prompt: 准确率从 17% 升到 78%。
```

### 为什么 CoT 有用？

理论解释还在争论，但有几个直觉：

1. **更多 token = 更多计算**。神经网络计算量正比于 token 数。让模型多输出几个 token = 给它多一些"思考空间"。
2. **链式约束**。一旦模型说出"罗杰原来有 5 个"，下一步它就难以矛盾自己。
3. **拆解复杂任务**。一步到位算 11 很难，分两步算（先 2×3=6，再 5+6=11）变简单了。

### 触发 CoT 的几种方式

```
方式 1: zero-shot CoT
  在 prompt 末尾加 "Let's think step by step." 或 "请一步步思考"

方式 2: few-shot CoT
  给几个"问题 + 推理 + 答案"的例子

方式 3: structured CoT
  要求 JSON 输出，里面专门一个字段叫 "reasoning"

方式 4: built-in (reasoning model)
  o1 / Claude with thinking 自动内部 CoT，外部看不到
```

---

## 5. Structured Output：把 LLM 输出变成可解析格式

LLM 输出是自由文本。但你的下游程序需要结构化数据——JSON、表格、SQL。怎么让模型乖乖输出？

### 方式 A：纯 prompt（最朴素）

```
"请以 JSON 格式输出，包含 name、age、city 字段："
```

问题：模型经常在 JSON 前后加废话（"好的，这是 JSON: ```json ..."），或者格式不严谨。

### 方式 B：JSON mode

OpenAI 和 Claude 都支持 `response_format = {"type": "json_object"}`。后端会强制 token 输出符合 JSON 语法。

```python
client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    response_format={"type": "json_object"}
)
```

### 方式 C：Structured Outputs / Tool Schema（最强）

把你想要的 JSON schema 也丢给 API。后端用 **constrained decoding**：每一步生成 token 时，把所有不符合 schema 的 token 概率置 0。

```python
schema = {
    "name": "string",
    "age": "integer",
    "city": "string"
}

client.chat.completions.create(
    model="gpt-4o",
    messages=[...],
    response_format={
        "type": "json_schema",
        "json_schema": {"schema": schema, "strict": True}
    }
)
```

这种方式**保证**输出符合 schema。底层是把 schema 编译成有限状态机，每生成一个 token 就裁剪可选 token 集。

### Constrained Decoding 的代价

- 略微降低输出质量（限制了模型的灵活性）
- 编译 schema 有开销
- 复杂嵌套 schema 可能让模型"卡住"

实战经验：**简单结构用 JSON mode，复杂 schema 用 structured outputs**。

---

## 6. Reasoning Model 的特殊用法

o1 / o3 / DeepSeek-R1 / Claude with thinking 这类**推理模型**和普通模型的用法**根本不同**。

### 关键区别 1：不能用 temperature / top-p 调风格

reasoning model 的内部推理过程是高度结构化的。强行调 temperature 会破坏推理链。OpenAI 直接禁止 o1 调 temperature。

### 关键区别 2：不需要 CoT prompt

普通模型靠 "Let's think step by step" 触发 CoT。reasoning model **内置**了 CoT——它在你看不到的内部 token 里推理，外部只输出最终答案。

```
普通模型 + CoT:
  prompt: "证明 √2 是无理数。Let's think step by step."
  output: "首先假设 √2 是有理数... 然后..." [可见推理]

o1:
  prompt: "证明 √2 是无理数。"
  [思考 45 秒，内部推理不可见]
  output: [最终证明]
```

### 关键区别 3：reasoning_effort 参数

o-系列有个独特参数：`reasoning_effort = low / medium / high`。

- **low**：思考几秒，适合简单任务
- **medium**：思考十几秒
- **high**：思考几分钟，做最复杂的推理

```python
client.chat.completions.create(
    model="o3",
    reasoning_effort="high",
    messages=[...]
)
```

成本和延迟都和 effort 成正比。

### 关键区别 4：prompt 风格不同

普通模型喜欢 step-by-step 引导。reasoning model **不需要**——你给详细指令反而可能限制它的思路。

```
对普通模型: "请先分析问题，列出几个可能方案，然后选最优的，最后给出代码。"
对 o1:      "解决这个问题。"  ← 简洁就好
```

第 22 篇会详细讲 reasoning model 的训练机制。这里只讲调用层面的差异。

---

## 7. 其他常被忽略的旋钮

### `max_tokens`：输出长度上限

容易忘记设，结果模型输出超长账单爆炸。

### `stop` / `stop_sequences`：遇到某序列就停

```python
stop=["\n\nUser:", "###"]
```

做 agent 时常用，避免模型自己"扮演用户"接着对话。

### `frequency_penalty` / `presence_penalty`：抑制重复

```
frequency_penalty=0.5: 出现过的 token 概率降低 50%
presence_penalty=0.5:  曾经出现过（一次以上）的 token 概率降低 50%
```

防止模型陷入"好好好好"这种循环。但调过头会让输出不自然。

### `seed`：可复现性

```python
seed=42
```

固定 seed 后，同一个 prompt 应该产生（接近）一样的输出。注意是 "应该"——浮点运算的非确定性让 100% 复现仍很难。

### `logprobs`：返回每个 token 的概率

```
logprobs=True, top_logprobs=5
```

不是给最终用户用的，是给开发者**调试**用的。能看到模型在每一步对每个候选 token 的"信心"。

---

## 8. 一个调用大模型的最佳实践模板

```python
client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "你是一个严谨的助手..."},
        {"role": "user", "content": "..."}
    ],
    temperature=0.3,        # 严肃任务用低 T
    max_tokens=2000,        # 控制账单
    response_format={        # 结构化输出
        "type": "json_object"
    },
    stop=["###"],            # 防越界
    seed=42                  # 调试期固定
)
```

实际生产中根据任务调整。一个项目可能有 5-10 套不同的调用配置，对应不同场景。

---

## 9. 给你的小作业

1. **同一个 prompt 用 T=0 和 T=1 各调 5 次，对比输出差异。**
2. **写一个需要结构化输出的小任务（如"从一段简历里提取姓名、电话、技能"），用 JSON mode 实现。**
3. **如果你给 o1 一个简单问题（"今天星期几"），你预期它会怎么处理？为什么不应该用 o1 做这种事？**

> **下一篇钩子**：调用参数搞定了。但 prompt 本身怎么写？
> 圈子里流传一句话："prompt engineering 不是写咒语，是压缩上下文。"
> 这是什么意思？为什么有些人写 prompt 一行就够，有些人写两千字模型还是出错？
> 下一篇我们讲 prompt engineering 的本质——和它**不**是什么。
