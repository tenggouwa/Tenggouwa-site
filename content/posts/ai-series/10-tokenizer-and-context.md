---
slug: tokenizer-and-context
title: Tokenizer 与 Context Window：模型眼里的世界
summary: AI 系列第 10 篇。LLM 不读字符，它读 token。一篇文章在它眼里不是字符流，而是 token 流。这一篇讲 BPE 算法是怎么把文字切成 token 的、为什么 LLM 数不清 strawberry 的 r、以及 context window 从 2K 卷到 1M 的工程惊悚故事。
tags: [ai, tokenizer, context, bpe, ai-series]
published_at: 2026-05-31
---

> AI 系列第 10 篇。这一篇钻进 LLM 最底层的输入端——**模型眼里的"字"长什么样**。

## 0. 一个让 GPT-4 都翻车的问题

```
你: "strawberry 这个单词里有几个字母 r ？"
GPT-4 (早期版本): "2 个。"

你: "请数一遍。s, t, r, a, w, b, e, r, r, y..."
GPT-4: "对，3 个 r。"

你: "那你刚才为什么说 2 个？"
GPT-4: "对不起，我数错了。"
```

这是个让人很多人困惑的现象——**这么聪明的模型，怎么连数字母都数不清？**

答案不在它"笨"，在它**根本看不到字母**。它看到的是 token。

```
"strawberry"
    │
    ▼ tokenize (GPT-4 BPE)
["straw", "berry"]   ← 模型实际看到的
```

模型看到两个 chunk：`straw` 和 `berry`。要它数 r，它得"想象"这两个 chunk 各自的字符——这就开始出错。

这就是 token 化（tokenization）的代价。今天我们把它讲清楚。

---

## 1. 为什么需要 tokenize？

我们在第 6 篇讲过 embedding。每个 token 对应一个向量。但**为什么不直接以字符为单位？**

### 方案 A：字符级（character-level）

```
"hello" → [h, e, l, l, o] → 5 个 token
```

优点：词汇表小（英文 26 字母 + 标点 ≈ 100 个 token）。
缺点：序列变长 5 倍。Transformer 是 O(n²)，序列长 5 倍 = 计算量大 25 倍。**太贵**。

### 方案 B：词级（word-level）

```
"hello world" → ["hello", "world"] → 2 个 token
```

优点：序列短。
缺点：词汇表太大（英文 50 万词以上）。embedding 表会爆炸。**而且没法处理新词**——遇到 "TenggouwaGPT" 这种就完蛋了。

### 方案 C：子词级（subword）—— BPE

折中：把常见词当一个 token，罕见词切成多个常见片段。

```
"hello"             → ["hello"]                  1 token
"Tenggouwa"         → ["Te", "ng", "gou", "wa"] 4 tokens
"running"           → ["run", "ning"]           2 tokens
"antidisestablish"  → ["anti", "dis", "establish"] 3 tokens
```

这就是 **BPE（Byte Pair Encoding）**——今天所有主流 LLM 都用的方案。

---

## 2. BPE 算法：用合并频率训练 tokenizer

BPE 起源于数据压缩领域，1994 年提出。NLP 圈在 2016 年（Sennrich 等）才把它捡起来用。

### 训练过程

**Step 1**：把所有训练文本切成单个字符。

```
"low low low low low" → l, o, w, ' ', l, o, w, ' ', ...
```

**Step 2**：统计相邻字符对的频率，合并最频繁的那对。

```
最频繁的字符对: 'l' + 'o' = "lo"
合并后: lo, w, ' ', lo, w, ...
```

**Step 3**：重复 Step 2，直到达到目标词汇表大小（如 50,000）。

```
迭代 N 次后:
  "lo" + "w" → "low"
  "low" + " " → "low "
  ...
```

最终你得到一个 50,000 大小的词汇表，包含：单字符、常见字根、完整常见词、空格-词组合等。

### 一个真实例子：GPT-4 tokenizer

```python
import tiktoken
enc = tiktoken.encoding_for_model("gpt-4")

enc.encode("Hello world")
# → [9906, 1917]

enc.encode("Hello, world!")
# → [9906, 11, 1917, 0]

enc.encode("strawberry")
# → [38088, 15717]    ← straw + berry

enc.encode("我喜欢吃草莓")
# → [37046, 119, 11883, 119, 33002, ...]   ← 中文要切碎得多
```

注意几个有趣的点：

- **空格通常和后面的词合并**。" Hello" 是一个 token，"Hello" 是另一个。
- **同样的词大小写不同 → 不同 token**。"Hello" vs "hello"。
- **中文比英文更费 token**。同一个意思英文 1.5 个 token，中文可能 5 个。

---

## 3. Tokenizer 带来的几个"奇怪现象"

### 现象 1：LLM 数不清字符

如前面所说，模型看到的是 token chunk，不是字符。

```
"strawberry"
→ ["straw", "berry"]
→ 模型: "我看到两个东西。第一个有 5 个字符里 1 个 r，第二个有 5 个字符里 2 个 r..."
→ 出错率高
```

**怎么解决**？让模型先把单词"打成字符"，再数：

```
prompt: "把 strawberry 拆成字符列表，然后数 r。"
GPT-4: "s, t, r, a, w, b, e, r, r, y → 3 个 r"   ✅
```

### 现象 2：数字处理混乱

```
"3.14159"
→ ["3", ".", "14", "15", "9"]
→ 模型看到的是这几段，不知道这是一个完整数字
```

这是为什么 LLM 算术容易错——它看到的不是数字，是文本片段。新一代模型（Llama-3, GPT-4o）专门优化了数字 tokenization（每位单独 token），算术能力有提升。

### 现象 3：少见字符成本极高

```
"🤖" (emoji)
→ 可能被切成 4 个 byte-level token
```

如果一段文本有很多 emoji、罕见 Unicode、外语，token 数会爆炸。GPT-4 处理日语比英语贵 50%，处理中文贵 30%。

### 现象 4：tokenizer 不同 → 输出不同

同一段文本，不同 tokenizer 切法不同。GPT 用 cl100k_base，Claude 用自己的，Llama 用 sentencepiece。这是为什么换模型时 prompt 经常需要重新优化。

---

## 4. Context Window：模型一次能"看"多少 token？

**Context window** 是模型一次推理时能处理的最大 token 数。

```
GPT-3 (2020):     2,048
GPT-3.5 (2022):   4,096
GPT-4 (2023):     8,192 / 32,768
GPT-4 Turbo:      128,000
GPT-4o:           128,000
Claude 2:         100,000
Claude 3:         200,000
Claude 3.5/4:     200,000 (Opus 1M)
Gemini 1.5 Pro:   1,000,000 → 2,000,000
Llama 3.2:        128,000
```

从 2020 到 2026，context window 涨了 **1000 倍**。这是 LLM 应用层最重要的变化之一。

### 为什么 context 越长越好？

- 能塞更多上下文（一整本书、整个代码库）
- 支持更长的对话历史
- RAG 检索到的文档可以更多
- Agent 可以记住更多步骤

### 为什么 context 长这么难？

Self-attention 是 O(n²)。

```
context = 1K: 100 万次注意力计算
context = 10K: 1 亿次
context = 100K: 100 亿次
context = 1M: 1 万亿次
```

光是显存就放不下——存一个 1M context 的 KV cache 要几百 GB。

---

## 5. 突破 O(n²) 的几种工程招数

### 招 1：Flash Attention（2022）

不改变 attention 数学，但**重写算子**，让它对 GPU 显存层级更友好。同样的计算量，速度快 2-3 倍，显存省 5-10 倍。

Stanford 的 Tri Dao 写的。今天几乎所有大模型都用它。

### 招 2：Sparse Attention

不算所有 token 对的 attention，只算"近的"或"重要的"。

```
完整 attention: 每个 token 看所有其他 token
Sparse attention: 每个 token 只看附近 + 一些关键 anchor
```

代表：Longformer、BigBird、Mixtral 的 sliding window。

### 招 3：Linear Attention 系列

把 attention 从 O(n²) 降到 O(n)，但要修改 attention 公式本身。

代表：Mamba（2023，状态空间模型）、RWKV、Linear Attention。

效果接近 Transformer，但不完全等价。目前没成为主流。

### 招 4：Ring Attention / Infini-Attention

把超长上下文切分到多个 GPU 上并行处理。

代表：Gemini 1.5 用的就是 ring attention 系。

### 招 5：KV Cache 压缩

KV cache 是 attention 的中间状态，占据大部分显存。压缩它可以省显存。

代表：H2O（2023）、StreamingLLM、各种 quantization。

---

## 6. Context window 长 ≠ 真的能用满

一个反直觉的事实——**虽然模型支持 200K context，但实际上它"专注度"会下降**。

研究者发现的 "needle in haystack"（草堆找针）现象：

```
把一句关键信息埋在 200K context 的中间位置。
问模型那句信息是什么。

结果: 大多数模型在中间位置准确率明显低于头尾。
```

这就是 **"lost in the middle"** 现象（2023 论文）。模型对开头和结尾的注意力强，对中间内容容易"遗忘"。

2024+ 的模型（Claude 3 / Gemini 1.5 / Llama 3.2）在这方面有显著改善，但还没完全解决。

> 一句你可以拿去吹的话：
> **Context window 长不等于"模型记住所有"。一个 1M context 的模型实际可用部分可能只有 100K——剩下都是 marketing。**

---

## 7. Context 长之后，一些新玩法

### 玩法 1：整个代码库丢进去

```
prompt = open("整个 repo 拼起来.txt").read()  # 800K tokens
prompt += "\n\n请找出所有可能有 SQL 注入的地方。"
```

不再需要 RAG，直接全文输入。Claude Opus 4.7 的 1M context 就是这思路。

### 玩法 2：长 agent 链不会"忘"

agent 跑 100 步，每步几千 token，总共几十万 token。在 8K 上下文时代根本玩不了。

### 玩法 3：多文档分析

把 50 篇论文一起丢进去问"这些论文的共识是什么？"。原来需要复杂的 RAG pipeline，现在 prompt 一行。

### 玩法 4：长视频理解

Gemini 把视频每秒 1 帧 + 音频转 text，一起塞进 context。一个 30 分钟视频几十万 token。

---

## 8. Tokenizer + Context 是个被忽视的核心基础设施

这两件事都不性感。论文不爱写，公众不关心。但它们决定了：

1. **模型成本**：token 数 × 单价 = 你的账单
2. **模型可处理任务的边界**：超出 context 就没法做
3. **prompt engineering 的上限**：token 不够再好的 prompt 也展不开
4. **模型某些"愚蠢错误"的根源**：数字母、算术、罕见词

理解 tokenizer 和 context，是从"会用 LLM"到"用好 LLM"的分水岭。

> 一句你可以拿去吹的话：
> **不懂 tokenizer 的人，永远在猜模型为什么犯傻；懂 tokenizer 的人，能预测它会在哪类问题上犯傻，并提前绕开。**

---

## 9. 给你的小作业

1. **去 [platform.openai.com/tokenizer](https://platform.openai.com/tokenizer) 把你的中文名输入，看它被切成几个 token。**
2. **为什么 GPT-4 对中文比对英文贵？给两个原因。**
3. **如果你做一个 RAG 系统，context 是 8K 还是 200K，对架构设计有什么本质区别？**

> **下一篇钩子**：到这里我们把"模型怎么训出来"和"模型眼里的世界"都讲完了。
> 但当你**调用** GPT-4 时，你会发现还有一堆参数——temperature、top-p、思维链、structured output、reasoning effort……
> 这些参数怎么影响输出？为什么 reasoning model（o1）和普通模型用法不一样？
> 下一篇我们讲推理时的全部"旋钮"。
