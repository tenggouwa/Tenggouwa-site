---
slug: rag
title: RAG：给模型外挂一个"知识硬盘"
summary: AI 系列第 13 篇。LLM 的训练数据有截止日期，也装不下你公司 10 万份内部文档。RAG 是给它外挂"知识硬盘"的标准方案。这一篇讲清楚 RAG 的完整流水线、向量搜索的真实局限、以及为什么"hybrid + rerank"才是生产级 RAG 的标配。
tags: [ai, rag, embedding, vector-search, ai-series]
published_at: 2026-06-03
---

> AI 系列第 13 篇。这一篇我们给 LLM 外挂一个"知识硬盘"——RAG。
> 你会发现一个反直觉的事实：**生产级 RAG 几乎从不只用向量搜索**。

## 0. LLM 的两个根本限制

LLM 强归强，有两个绕不开的限制：

1. **知识冻结**：模型训完之后，新知识进不去。GPT-4o 训练截止是 2023.10，今天问它 2024 年的新闻它根本不知道。
2. **私有知识进不去**：你公司的内部文档、数据库、Wiki，模型没见过。

直接的"暴力解"是**重新训练**。但每次重训一个 70B 模型要几千万美元——这显然不现实。

**RAG（Retrieval-Augmented Generation，检索增强生成）** 就是为这两个限制设计的：

> **不更新模型，而是在每次提问时，先去外挂的知识库找相关内容，把这些内容拼到 prompt 里。**

```
用户问题
   │
   ▼
[Retrieval] ──▶ 知识库 ──▶ Top-k 相关片段
   │                              │
   └──────────────┬───────────────┘
                  ▼
       prompt = 问题 + 相关片段
                  │
                  ▼
                LLM
                  │
                  ▼
                回答
```

这一篇我们讲清楚每一步。

---

## 1. RAG 流水线的 5 个阶段

```
┌─────────────────────────────────────────────────────┐
│ 1. Ingest    把文档加载进来                          │
│ 2. Chunk     切成小块                                │
│ 3. Embed     每块变成向量                            │
│ 4. Retrieve  收到问题时找相关块                       │
│ 5. Generate  把块塞进 prompt 让 LLM 回答              │
└─────────────────────────────────────────────────────┘
```

每一步都有坑。

---

## 2. Stage 1: Ingest（数据接入）

**任务**：把各种格式的文档（PDF、Word、HTML、Notion、Slack、数据库）抽取成纯文本。

听起来简单，**实际是 RAG 项目最先翻车的地方**：

- **PDF**：扫描版 PDF 需要 OCR；表格、公式经常乱掉。
- **HTML**：脏 HTML 里都是 navigation、广告、版权声明这些噪声。
- **Word/PPT**：图表里的字提取不到；多列布局识别顺序错。
- **代码**：函数、类的层级要保留。

**经验法则**：花在 ingest 上的时间是 RAG 项目里最被低估的。一个能干净抽 PDF 的 pipeline 比再好的 embedding 模型更重要。

**主流工具**：
- `unstructured.io`：通用文档解析
- `LlamaParse`：专门优化 PDF / 复杂布局
- `pdfplumber`：精确表格提取
- `pymupdf4llm`：PDF → markdown，对 LLM 友好

---

## 3. Stage 2: Chunk（切分）

**任务**：把长文档切成 200–1000 token 的小段。

**为什么要切？**

- LLM context window 有限（虽然 1M 来了，但小 chunk 检索更精确）
- embedding 模型有最大输入长度（一般 8K）
- 大文档里"相关片段"通常很集中，全文都塞进 prompt 浪费

**切分策略**：

### 策略 A：固定大小（dumbest）

```
chunk_size = 500 tokens
overlap = 50 tokens  # 防止边界处信息被切碎
```

简单。但经常在句子中间切断。

### 策略 B：按结构切

```
按段落切 → 按 markdown header 切 → 按 sentence 切
```

保留语义完整。但块大小不均匀，有的太短有的太长。

### 策略 C：递归切（生产级首选）

```
1. 先按 ## header 切
2. 如果块还太大，按段落切
3. 如果还太大，按句子切
4. 最差情况按字符切
```

LangChain 的 `RecursiveCharacterTextSplitter` 是这思路。

### 策略 D：语义切（最新）

用一个小 LLM 决定"哪里是语义边界"。质量最高，成本也最高。

**经验**：先用策略 C 跑起来。出了问题再考虑 D。

---

## 4. Stage 3: Embed（嵌入）

**任务**：把每个 chunk 变成一个向量（通常 1024–4096 维）。

这个步骤就是第 6 篇讲的 embedding。差别是**这里用专门的 embedding 模型**，而不是大模型内部的 embedding 层。

### 主流 embedding 模型

| 模型 | 维度 | 特点 |
|---|---|---|
| OpenAI text-embedding-3-large | 3072 | 性能强，要钱 |
| Cohere embed-v3 | 1024 | 多语言强 |
| BGE-M3 | 1024 | 开源最强之一，中文友好 |
| Voyage-3 | 1024 | RAG 专门优化 |
| Jina-embeddings-v3 | 1024 | 开源 |

**选 embedding 模型的关键**：

1. **你的语言**：中文用 BGE / Jina / Voyage 中文专用版。
2. **领域**：医疗 / 法律 / 代码各有专用版。
3. **成本**：开源模型自己跑，OpenAI / Cohere 按 token 计费。

### 一个常被忽视的细节：query embedding 用同一个模型

```
ingest: chunk 用 model X embed
retrieve: query 用 model X embed  ← 必须一致！
```

如果 ingest 和 retrieve 用了不同模型，检索质量会暴跌。

---

## 5. Stage 4: Retrieve（检索）

这是 RAG 里**坑最多**的一步。

### 5.1 朴素方案：纯向量检索

```python
query_vec = embed(query)
results = vector_db.search(query_vec, top_k=5)
```

简单，但有几个明显问题：

#### 问题 1：精确匹配失效

```
用户问: "找出 GPT-4.5 的发布日期"
向量搜索: 可能返回各种"模型发布"相关的段落，但"GPT-4.5"这个精确名字反而被泛化掉了。
```

**向量是模糊匹配，关键词搜索才是精确匹配**。

#### 问题 2：相似 ≠ 相关

```
query: "如何配置 nginx 的 SSL"
向量搜索 top-1: 一段讲"如何配置 Apache 的 SSL"——语义上很像，但不是用户想要的。
```

#### 问题 3：长尾词权重低

```
query: "Tenggouwa 的部署脚本"
"Tenggouwa" 是罕见词，但**它才是关键**。向量搜索可能被"部署脚本"主导。
```

### 5.2 生产级方案：Hybrid Search

把向量搜索 + 关键词搜索（BM25）合起来：

```python
vec_results = vector_db.search(query_vec, top_k=20)
kw_results  = bm25.search(query, top_k=20)
combined = reciprocal_rank_fusion(vec_results, kw_results)  # 融合两个排名
top_k = combined[:10]
```

向量负责"语义相关"，BM25 负责"关键词精确匹配"。两者互补。

**几乎所有生产级 RAG 都是 hybrid**。LangChain、LlamaIndex、Vespa 都内置支持。

### 5.3 Rerank：质量分水岭

hybrid 搜出来的 top-20 还需要**重新排序**——用一个更精确、更慢的 rerank 模型。

```python
candidates = hybrid_search(query, top_k=20)
rerank_scores = rerank_model.score(query, candidates)  # cross-encoder
top_5 = sorted(candidates, key=rerank_scores)[:5]
```

**Cross-encoder** 是什么？它和 embedding 模型（bi-encoder）不同：

- **Bi-encoder（embedding）**：query 和 doc 各自编码成向量，比距离。快，但粗。
- **Cross-encoder（rerank）**：query 和 doc **一起**输入到 transformer，输出相关性分数。慢，但准。

```
Bi-encoder:     ✓ 快 ✗ 粗   →   适合从 100 万文档里找 100 个候选
Cross-encoder:  ✗ 慢 ✓ 精   →   适合从 100 个候选里挑 5 个
```

主流 rerank 模型：Cohere `rerank-3`、`bge-reranker-v2`、Jina `jina-reranker-v2`。

加了 rerank 之后，RAG 的回答质量通常提升 20–30%。**这是从 demo 级到生产级最关键的一步**。

---

## 6. Stage 5: Generate（生成）

**任务**：把 top-k 相关 chunk 拼到 prompt 里，让 LLM 回答。

```
prompt:
  上下文（来自知识库）:
  ---
  [chunk 1 内容]
  ---
  [chunk 2 内容]
  ---
  [chunk 3 内容]
  ---
  
  基于上述上下文，回答以下问题：
  [用户问题]
  
  规则：
  - 如果上下文没有相关信息，回答"未找到相关信息"，不要编造
  - 引用来源时用 [chunk N] 格式
```

### 几个关键工程点

#### 1. 防幻觉

明确告诉模型"没找到就说没找到"。否则它会在没相关上下文时也编一段答案。

#### 2. Citation（引用）

让模型在回答里标注 [chunk N]，方便用户回溯到原文档。

#### 3. Context 太长怎么办

如果 top-10 chunk 加起来 50K token，全塞进 prompt 又贵又慢：

- **筛选**：rerank 后取 top-3 而非 top-10
- **压缩**：用小 LLM 先把 chunk 摘要一遍
- **多轮**：先让 LLM 自己挑哪几个 chunk 相关，再生成

---

## 7. RAG 的常见高级技巧

### 技巧 1：Query Rewriting

用户问"它的价格怎么样？"——"它"是啥？检索失败。

```
原始 query: "它的价格怎么样？"
对话历史:   [上轮在聊 Macbook Pro]
↓
LLM rewrite: "Macbook Pro 的价格怎么样？"
↓
检索
```

### 技巧 2：HyDE（Hypothetical Document Embeddings）

让 LLM 先**伪造**一个理想答案，再用这个答案去检索。

```
query: "如何用 Python 读取 PDF?"
↓
LLM fake answer: "你可以用 PyPDF2 库。先 pip install PyPDF2，然后 open()..."
↓
embed(fake answer) → 用这个向量检索
```

研究显示对零样本场景效果显著。

### 技巧 3：Multi-Query

让 LLM 把一个 query 拆成多个变体，分别检索后合并。

```
原 query: "如何提高 Python 性能？"
变体:
  - "Python 性能优化方法"
  - "Python 慢的原因"
  - "PyPy 和 CPython 区别"
```

提升召回率。

### 技巧 4：Graph RAG（2024 新方向）

不只用向量，把文档**预构建成知识图谱**，按实体和关系检索。

```
文档 → 抽取实体 + 关系 → 知识图谱
查询时: 找到 query 涉及的实体 → 沿图遍历相关节点
```

Microsoft GraphRAG（2024）开源后引爆。适合需要多跳推理的场景。

---

## 8. RAG vs Long Context：还要不要 RAG？

Claude Opus 1M context、Gemini 2M context——既然能塞下整本书，还要不要 RAG？

**还要。** 原因：

1. **成本**：1M context 的单次调用 $10+。RAG 每次调用 $0.01 级。
2. **延迟**：1M context 单次响应几十秒。RAG 几秒。
3. **lost in the middle**：长上下文中间部分模型注意力下降。RAG 精准提取只给真正相关的。
4. **数据规模**：你有 100M+ token 文档？再长的 context 也塞不下。

**结论**：RAG 还是默认方案。Long context 适合**临时 + 不需要重复用**的场景（如"分析这一份 200 页报告"）。

---

## 9. 给你的小作业

1. **画一个 RAG 系统的架构图，明确每一步用的工具。**
2. **解释为什么 "hybrid search + rerank" 比纯向量搜索效果好。**
3. **如果你做一个法律咨询的 RAG，引用准确性比生成流畅度更重要——你会在 pipeline 里加哪些控制？**

> **下一篇钩子**：RAG 让 LLM 能"查资料"。
> 但更进一步——让 LLM 能**调用真实世界的 API**：查天气、订餐、发邮件、运行 shell 命令——这就是 tool use（function calling）。
> 下一篇我们讲，模型怎么"学会打电话给真实世界"。
