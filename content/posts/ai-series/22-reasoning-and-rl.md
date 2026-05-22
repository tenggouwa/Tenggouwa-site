---
slug: reasoning-and-rl
title: 推理模型与 RL 的回归：o1 / R1 之后路通向哪
summary: AI 系列第 22 篇。2024 年 o1 出现，标志着大模型从"快速反应"走向"慢思考"。2025 年 DeepSeek R1 开源了同等级的推理能力，让全行业震动。这一篇讲 reasoning model 是怎么训的、RL 为什么在 LLM 时代"回来了"、以及 test-time compute scaling 的新范式。
tags: [ai, reasoning, rl, o1, r1, ai-series]
published_at: 2026-06-12
---

> AI 系列第 22 篇。这一篇讲 LLM 最近一次大转折——reasoning model。

## 0. 一个 2024 年改变行业的发现

2024 之前，LLM 的"思考"是单次前向计算。
2024 之后，LLM 开始"先想很久，再回答"。

```
GPT-4o:    用户问 → 立即响应 → 答案
o1:        用户问 → 思考 30 秒 → 答案
o3-high:   用户问 → 思考 5 分钟 → 答案
```

时长换准确率。简单粗暴。但效果出奇地好。

```
AIME 数学竞赛:
  GPT-4o:   13%
  o1:       83%
  o3:       96%
```

这就是 **reasoning model**——LLM 发展的第三阶段。

```
Stage 1 (2018-2022): pretrain scaling
Stage 2 (2022-2024): RLHF + post-training
Stage 3 (2024+):     test-time compute scaling
```

这一篇讲清楚 Stage 3 是怎么回事。

---

## 1. Scaling Laws 撞墙之后

第 8 篇我们讲了 scaling laws。一个被默默接受的事实：**2024 年后，单纯放大模型的收益急剧下降**。

```
GPT-3 → GPT-4: 100× 参数, 性能提升明显
GPT-4 → GPT-5: 训练成本 ×10, 性能提升很小
```

Sutskever 在公开采访说过："pretrain scaling is over." 这话有争议，但反映了趋势。

行业怎么办？三条路：

1. **数据 scaling**：找新数据 / 合成数据 / 多模态
2. **post-training scaling**：更多 RLHF / DPO / 长任务训练
3. **test-time compute scaling**：让模型在 inference 时多算

o1 走的是路径 3。**让推理时"想得更久"，比让模型"知道得更多"更有效**。

---

## 2. 思维链（CoT）的极致化

回忆第 11 篇讲的 chain-of-thought：让模型在给最终答案前先输出推理过程，准确率显著提升。

```
Q: "如果一艘船 1L 油跑 10km，500km 要多少油？"
A: "50L" ← 直接答容易错
A: "船 1L 油跑 10km，所以 500km 需要 500/10 = 50L 油。" ← CoT 答对
```

CoT 的本质是 **用 token 换计算**。token 多 = transformer 走更多 forward pass = 实际计算量增加。

### o1 的核心想法：把 CoT "训进模型"

普通模型靠 prompt 触发 CoT。o1 **不需要 prompt**，它在训练时就被训得"先想再答"。

```
普通模型:
  prompt: "证明 √2 是无理数"
  output: "假设 √2 是有理数..." [思考过程在输出里]

o1:
  prompt: "证明 √2 是无理数"
  [内部 thinking tokens: 假设 √2 = a/b... 但... 那么... 矛盾...]
  output: [最终证明]
  thinking tokens 不显示给用户
```

它的 thinking 可以非常长。复杂数学题 o1-high 可以"想"几万 token。

---

## 3. RL 怎么训出 reasoning？

o1 的训练用了大量 RL。具体方法 OpenAI 没公开，但 DeepSeek-R1（2025.01 开源）公开了相似路线，让全行业都看清了。

### DeepSeek-R1 的训练管线

```
Step 1: Base model (DeepSeek-V3)
   ↓
Step 2: 收集"思维链"数据
   - 让模型对数学/代码题生成长 reasoning + 最终答案
   - 自动验证最终答案（数学有标准答案，代码看能否通过测试）
   - 留下"正确解"，丢掉"错的"
   ↓
Step 3: 在正确解上 SFT
   - 让模型学会"长思考 → 正确答案"的模式
   ↓
Step 4: RL with verifiable rewards (RLVR)
   - 让模型自由生成 thinking + answer
   - 奖励信号：答案正确 = +1，错误 = 0
   - 用 GRPO 算法（PPO 的变种）更新参数
   ↓
Step 5: 再来几轮 SFT + RL，持续提升
```

### 关键创新：可验证奖励（Verifiable Rewards）

RLHF 的奖励来自**人**（或 RM 模型），不够精确。

RLVR 的奖励来自**程序自动验证**：

```
数学题:    答案正确 = +1  → 100% 可验证
代码题:    通过测试 = +1 → 100% 可验证
推理题:    最终选项对 = +1 → 100% 可验证
```

**这种自动 reward 让 RL 可以无监督地大规模扩展**。模型可以自己生成 → 自己验证 → 自己学。Anthropic 在 Claude 4 系列也用了类似路径。

### 涌现的"反思"行为

R1 训练过程中，研究员观察到一个 spontaneous 现象——

模型在长 thinking 中开始**自我检查、回溯、重新尝试**：

```
"... 假设 x = 5. 但等等，这不对。
   让我重新考虑这个问题。
   实际上 x 应该是 3。
   验证一下: 3 + 4 = 7, 是的，对的。"
```

研究员没有显式训这种行为。它**自然涌现**了。这有点像"模型在长 thinking 里学会了 meta-cognition"。

---

## 4. Test-Time Compute Scaling：新维度的 scaling law

OpenAI 和 DeepSeek 都发现了：

> **同一个 reasoning model，给它更多 thinking token，性能持续上升。**

```
o3-mini, reasoning_effort=low:    AIME 60%
o3-mini, reasoning_effort=medium: AIME 75%
o3-mini, reasoning_effort=high:   AIME 87%
```

这是一种**新的 scaling law**：

- 老 scaling：增加 **训练**算力 → 更好的模型
- 新 scaling：增加 **推理**算力 → 同一个模型更好的输出

### 为什么这是个根本性变化？

#### 变化 1：用户视角

用户可以**选择**对每个问题花多少算力。简单问题低 effort，难问题 high。

```
"今天星期几" → effort=low, 1 秒
"证明黎曼猜想" → effort=max, 10 分钟
```

#### 变化 2：成本结构

老 scaling 是**沉没成本**：训出来再说。
新 scaling 是**边际成本**：每次推理直接花钱。

这让"用户为难题付费"成了商业模式。

#### 变化 3：推理算力市场

如果 test-time compute 是关键，那 GPU 部署的瓶颈从训练（少数大厂）转向推理（每家公司、每个用户）。

NVIDIA 推理芯片销量在 2025 暴涨。专门做推理的初创（Groq、Cerebras、SambaNova）开始火。

---

## 5. 谁能跟上 reasoning 这条路？

### OpenAI o 系列

- **o1**（2024.09）：第一代
- **o3**（2024.12）：更强，AIME ~95%
- **o3-mini**（2025.01）：开放使用
- **o4 系列**（2025）：和 GPT-5 集成

### DeepSeek

- **R1**（2025.01）：第一个开源同级别 reasoning，**震动了整个行业**
- **R1 训练成本据报道只有 600 万美元**，远低于 GPT-4 级别。这次发布直接让美股 NVIDIA 一天跌 5000 亿美元。

### Anthropic

- **Claude 3.7 Sonnet with thinking**（2025.02）：第一个把 reasoning 集成进通用模型
- **Claude 4.X Opus**：reasoning 作为可选模式，用户可控制深度

Anthropic 的特色：**reasoning 和普通对话用同一个模型**。OpenAI o-系列是独立模型。

### Google

- **Gemini 2.5 with Deep Think**（2025）：跟进 reasoning

### 中国其他

- **Qwen QwQ**：阿里
- **Kimi K2 reasoning**：月之暗面
- **GLM-Z1**：智谱

---

## 6. Reasoning 还能 scale 多远？

几个未解问题：

### 问题 1：thinking 越长越好吗？

经验：到一定长度后，准确率 plateau，再长反而开始下降（模型困惑、改变主意、矛盾自己）。

最优长度依任务而定。简单题 100 token，难题 50K token。

### 问题 2：reasoning 能 transfer 吗？

R1 在数学/代码上 RL 训练，但在创意写作、对话上也变强了。这是好消息——reasoning 是 transferable 能力。

但 transfer 的强度依然有限。专门训过的领域强很多。

### 问题 3：RL 数据怎么找新的？

RLVR 依赖**可自动验证**的任务。数学、代码、有标准答案的逻辑题——这些数据已经被刷得差不多了。

下一个增长点在哪？

- **形式证明**（Lean / Coq）：可验证但数据稀缺
- **科学实验**：可验证但贵
- **物理模拟 task**：可验证，结合 world model

### 问题 4：会不会撞 reasoning scaling 墙？

2026 年还没看到撞墙。但有人警告：reasoning 也有边际效益递减的可能。

---

## 7. Reasoning 的实际产品形态

### 形态 1：科研助手 / 数学家辅助

```
研究者: "帮我证明这个引理"
o3:   思考 5 分钟，输出严格证明
```

数学界已经开始用 reasoning model 做严肃工作。

### 形态 2：复杂代码 / 系统设计

```
"重构这 100 个文件，把 React class component 全改成 hooks"
→ Claude with thinking 思考 + 调工具 + 多步执行
```

reasoning + agent 是 2026 软件开发的主力工作流。

### 形态 3：长决策 / 战略分析

```
"帮我分析这个商业计划的风险"
→ 长 thinking 中权衡多维因素
```

咨询、投资、法律领域开始大量用 reasoning model。

### 形态 4：作为 agent 的"大脑"

agent 跑长任务时，每一步都用 reasoning model 决策。比"快速反应"模型稳得多。

> 一句你可以拿去吹的话：
> **2024 年之前的 LLM 是"反射神经"，2024 年之后开始有"前额叶"。reasoning model 让 AI 从"快思考"走进了"慢思考"。**

---

## 8. 给你的小作业

1. **解释 verifiable reward 比 RLHF 在 reasoning 上有什么优势。**
2. **同一个问题给 GPT-4o 和 o3-mini，输出会怎么不同？**
3. **如果你的产品需要 reasoning，你会自己 fine-tune 一个 R1 还是付费用 OpenAI API？给三个考量维度。**

> **下一篇（也是最后一篇）钩子**：到这里我们走完了整个 AI 系列。
> 最后一篇我们做一次 birds-eye 对比——
> 开源生态（Llama / Qwen / DeepSeek）和闭源前沿（Anthropic / OpenAI / Google）今天的牌面到底怎么样？
> 谁在领跑、谁在追赶、未来 12 个月最值得关注的是什么？
