---
slug: evals
title: Evals：怎么知道模型"真的变好了"而不是看起来变好了
summary: AI 系列第 17 篇。"GPT-5 比 GPT-4 强"——你怎么验证？AI 工程里最被低估的一块是 evals（评估）。这一篇讲清楚 LLM benchmark 的局限、为什么 leaderboard 越来越没用、以及生产级 evals 应该怎么做。
tags: [ai, evals, benchmark, ai-series]
published_at: 2026-06-07
---

> AI 系列第 17 篇。这一篇讲一个最不性感、却最重要的话题——evals。
> 没有 evals，所有"模型变强了"的说法都是嘴炮。

## 0. 一个让所有 AI 团队尴尬的问题

你做了一个 RAG 系统，跑了 3 个月。老板问你：

```
老板: "上个季度模型从 Claude 3 升到 Claude 4 了。我们效果提升了多少？"
你:  "呃……感觉好很多……？"
老板: "感觉？"
```

**没有 evals**，你回答不了这个问题。

更糟的是——**你也不知道有没有 regress**。换 prompt、换模型、加新工具，每次改动都可能让某些 case 变好、某些变差。没有 evals 你就是在裸奔。

这一篇我们讲怎么不裸奔。

---

## 1. LLM 时代的 evals 比传统 ML 难得多

传统 ML 评估很简单：

```
分类: accuracy / F1
回归: RMSE / MAE
推荐: NDCG / MAP
```

输入 → 模型 → 输出。把输出和 ground truth 对比，算分。

LLM 评估**根本不适用这套**。原因：

1. **输出是自由文本**。"明天天气晴，22 度" vs "明日多云，温度 22℃" 都对，怎么自动判断？
2. **任务多样**。同一个模型既要写代码又要写诗又要做数学。一个指标盖不全。
3. **没有唯一正确答案**。诗、邮件、设计文档——好坏主观。
4. **数据集会被污染**。公开 benchmark 一旦发布，可能很快混进训练数据。

这些坑让 LLM 评估变成 AI 圈最难的工程问题之一。

---

## 2. 主流 Benchmark 巡礼

先看公开 benchmark。它们不能直接用于你的产品，但反映模型的"通用能力"。

### MMLU（Massive Multitask Language Understanding）

57 个学科的多选题，从初等数学到法律到道德哲学。

```
GPT-3 (2020):       43%
GPT-4 (2023):       86%
Claude 3 Opus:      87%
GPT-4o (2024):      88%
Claude 4 (2025):    93%
人类专家:           90%
```

**问题**：基本被刷爆了。Top 模型差距已经 < 2%，区分度不够。

### HumanEval

164 道 Python 函数题，看模型写代码能不能通过测试。

```
GPT-3.5:    48%
GPT-4:      67%
Claude 3.5: 92%
GPT-4o:     90%
```

**问题**：题目太简单（leetcode easy 难度），且早被刷爆。

### MATH

5000 道数学竞赛题。

```
GPT-4:      53%
o1:         83%
o3:         96%
```

**问题**：reasoning 模型刷上来后，区分度也接近饱和。

### GPQA Diamond

200 道博士级别问题（物理 / 化学 / 生物）。

```
GPT-4:      36%
Claude 3.5: 60%
o1:         77%
o3:         87%
```

**问题**：人类 PhD 也只能做到 60-70%，已经到天花板了。

### SWE-bench / SWE-bench Verified

真实 GitHub issues。让模型读代码库、定位 bug、写补丁。

```
2023 GPT-4:        ~4%
2024 Claude 3.5:   ~30%
2025 Claude 4:     ~70%
2026 现在前沿:     ~80%
```

**这是目前最能反映"AI agent 实际能力"的 benchmark**。难度高、贴近真实。

### LMSYS Chatbot Arena

人类盲测投票。两个模型给同一 prompt 输出，人选哪个更好。

```
2024 顶级:  GPT-4o, Claude 3.5
2025:       Claude 4, o3, Gemini 2
2026:       Claude Opus 4.7, GPT-5
```

**优点**：贴近真实用户体感。
**缺点**：投票偏向 sycophant（讨好的）回答。

---

## 3. 为什么 Leaderboard 越来越没用

2024 之后大家发现一个事实——**leaderboard 分数和实际产品体感越来越脱钩**。

原因：

### 原因 1：数据污染

公开 benchmark 一旦发布，几个月内就可能混进训练数据。模型不是"会做"，是"记得"。

**Goodhart's Law 出现**：当一个指标变成目标，它就不再是好指标。

### 原因 2：训练时针对性优化

各家实验室都对热门 benchmark 做 SFT / RL。结果：benchmark 分数刷高了，泛化能力没真的提升。

### 原因 3：任务分布偏

MMLU 是多选题，HumanEval 是简单函数。但**真实 LLM 使用场景**是：写复杂 prompt、修长代码、做多轮推理、用 tools。Benchmark 测不到这些。

### 原因 4：模型差异 > benchmark 差异

GPT-4o 和 Claude 3.5 在 MMLU 上差 2%——但在你的具体任务上，可能 Claude 强 30%，也可能 GPT-4o 强 30%。**通用分数 ≠ 你任务上的分数**。

> 一句你可以拿去吹的话：
> **2025 之后挑模型不能看 leaderboard。要自己跑 evals。**

---

## 4. 生产级 Evals 怎么做

公开 benchmark 不靠谱，那怎么办？**自己写 evals**。

### Step 1: 收集 eval 数据集

```
✅ 来源:
  - 真实用户日志
  - 你的产品 use case
  - 故意构造的 edge case

✅ 数量:
  - 起步: 50-100 个
  - 成熟: 500-2000 个
  - 不需要上万——质量比数量重要
```

### Step 2: 定义评分标准

这是最难的一步。三种主流方式：

#### 方式 A：精确匹配 / Regex

适用：分类、提取、有明确答案的任务。

```python
expected = "positive"
predicted = llm("分析情感: 我今天很开心")
score = (expected == predicted)
```

#### 方式 B：执行测试

适用：代码生成。

```python
code = llm("写一个 fibonacci 函数")
exec(code)
assert fibonacci(10) == 55
```

#### 方式 C：LLM-as-judge

适用：开放性任务（写作、对话）。

```python
judge_prompt = f"""
判断回答 A 和回答 B 哪个更好。
问题: {question}
A: {answer_a}
B: {answer_b}

按以下标准评分:
- 准确性 (1-5)
- 完整性 (1-5)
- 简洁度 (1-5)

输出 JSON: {{"winner": "A" | "B", "scores": ...}}
"""
result = judge_llm(judge_prompt)
```

**LLM-as-judge 的坑**：

- 同模型评同模型 → 偏自己
- 顺序偏好 → A/B 顺序换位置结果可能不同
- 长回答偏好 → judge 倾向给长回答高分

**对策**：
- 用更强的模型当 judge（评 GPT-4 用 Claude，反之）
- 双向 A/B 测两次取平均
- 显式告诉 judge "长度不是评分标准"

### Step 3: 跑 baseline

把现有的 production 系统跑一遍，记下分数。这是你的 baseline。

### Step 4: 改动 → 跑 evals → 对比

每次改 prompt / 换模型 / 调参数前，先跑 evals。改完再跑一次。

**关键**：差距 > 5% 才算真改善。1-2% 在噪声范围内。

### Step 5: 持续维护数据集

```
- 每周从用户日志加 10 个新 case
- 修复发现的 bug 后，把这个 case 加进 regression set
- 定期 review 旧 case 是否还相关
```

---

## 5. Evals 框架

主流工具：

### 开源

- **DeepEval**：Pytest 风格，结构化
- **Promptfoo**：YAML 配置，CLI
- **Inspect AI** (UK AISI)：科研级，最严谨
- **Ragas**：专门评 RAG

### 商业

- **Braintrust**：YC 出品，UI 好
- **LangSmith**（LangChain）：和 LangChain 集成
- **HumanLoop**：人工标注 + 自动评估

### 一个最小示例（DeepEval）

```python
from deepeval import assert_test
from deepeval.test_case import LLMTestCase
from deepeval.metrics import AnswerRelevancyMetric

test_case = LLMTestCase(
    input="北京什么时候降温？",
    actual_output=my_rag.query("北京什么时候降温？"),
    retrieval_context=["北京一般 10 月开始降温..."],
)

metric = AnswerRelevancyMetric(threshold=0.7)
assert_test(test_case, [metric])
```

把 evals 当**单元测试**一样跑。CI 里每个 PR 都跑一遍。这是 LLM 时代的工程化。

---

## 6. 几种 evals 的反模式

### 反模式 1：只测整体不测拆解

```
❌ "我的 RAG 准确率 80%"
✅ "检索阶段 recall@5 = 90%; rerank precision = 85%; 生成阶段 faithfulness = 95%"
```

整体一个数掩盖了哪一步是瓶颈。

### 反模式 2：用同模型 self-eval

让 GPT-4 自己评 GPT-4 的输出。误差大。

### 反模式 3：没有 baseline

只看绝对分数，没有对照组。"准确率 75%" 意味什么？比上版好还是差？

### 反模式 4：N=10

10 个 case 跑出的分数噪声太大。最少 100 个，最好 500+。

### 反模式 5：evals 一次性写完

evals 数据集应该**和产品一起持续演化**。一次性写完跑半年的 evals，越用越脱节。

---

## 7. Evals 的真实价值不只是"分数"

写 evals 的过程，本身就是一次**对产品的深度理解**。

- 你被迫定义 "什么是好回答"
- 你被迫枚举 edge case
- 你被迫想清楚 "用户真的关心什么"

很多团队跑了 evals 之后发现："原来 30% 的 case 我们的 prompt 完全没考虑到。" —— **这种发现比 benchmark 数字本身更有价值**。

> 一句你可以拿去吹的话：
> **写 prompt 是写代码，写 evals 是写规格说明书。没规格的代码改 100 次还是不知道对不对。**

---

## 8. 给你的小作业

1. **挑一个你常用的 LLM 任务，写 10 个 eval case（输入 + 期望输出）。**
2. **用 LLM-as-judge 给这 10 个 case 打分，写一个 judge prompt。**
3. **解释为什么不该用同一个模型既做生成又做评判。**

> **下一篇钩子**：evals 让我们知道模型表现"好不好"。
> 但还有更深的问题：模型是不是"对人有用、对人无害、说真话"？
> 这就是 alignment（对齐）——AI 工程里最有哲学味道、又最有工程紧迫性的话题。
> 下一篇我们看，怎么把"诚实、有用、无害"工程化。
