---
slug: local-deployment
title: 本地化部署：从 llama.cpp 到 vLLM，自己跑个推理服务
summary: AI 系列第 19 篇。闭源 API 贵、有限制、需要联网。这一篇讲怎么在自己机器上跑 LLM——从 MacBook 跑 7B / 70B 模型的 llama.cpp，到生产服务器的 vLLM / SGLang / TGI，再到量化（GPTQ / AWQ / GGUF）让 70B 跑进 48GB 显存。
tags: [ai, local, llama-cpp, vllm, quantization, ai-series]
published_at: 2026-06-09
---

> AI 系列第 19 篇。这一篇讲怎么把 LLM 从云上"搬"到自己机器上。
> 你会发现：MacBook 上跑个像样模型，今天真不是天方夜谭。

## 0. 为什么要本地部署？

闭源 API（OpenAI / Anthropic）又快又好用，为什么折腾本地？

### 理由 1：成本

```
GPT-4 API: $30 / 1M input tokens
本地 70B 模型: 一台 H100 一个月折旧 $1500，跑 8 并发服务 → 单 token 几乎免费
```

高并发场景下本地省钱。

### 理由 2：数据隐私

医疗 / 金融 / 律所 / 政企，数据不能出公司网络。

### 理由 3：定制 fine-tune

闭源模型只能 prompt，本地能 fine-tune / 改架构 / 加 LoRA。

### 理由 4：可用性

API 偶尔 down，限流。本地完全自主。

### 理由 5：研究 / 学习

想看模型内部？只能本地。

---

## 1. 主流开源模型生态（2026）

```
Meta Llama 系:
  - Llama 3.1 8B / 70B / 405B
  - Llama 3.2 (轻量 1B/3B + 多模态 11B/90B)
  - Llama 3.3 70B (2024.12)
  - Llama 4 (推测 2026)

阿里 Qwen 系:
  - Qwen 2.5 0.5B / 1.5B / 3B / 7B / 14B / 32B / 72B
  - Qwen 2.5-Coder (代码专用)
  - Qwen 2.5-VL (多模态)
  - Qwen 3 (2025 后)

DeepSeek 系:
  - DeepSeek-V3 (671B MoE，激活 37B)
  - DeepSeek-R1 (推理模型)
  - DeepSeek-Coder

Mistral 系:
  - Mistral 7B / Mixtral 8x7B / 8x22B
  - Mistral Large 2

其他:
  - Google Gemma 2 / 3
  - Microsoft Phi 3 / 4 (小模型路线)
```

**选模型口诀**：

- 通用对话 → Llama 3.3 70B / Qwen 2.5 72B
- 中文为主 → Qwen 系
- 代码 → DeepSeek-Coder / Qwen-Coder
- 推理任务 → DeepSeek-R1
- 小机器 / 嵌入式 → Phi 3 / Gemma 2B / Qwen 2.5 1.5B
- 极致性能（有 GPU 群） → DeepSeek-V3 / Llama 405B

---

## 2. llama.cpp：本地推理的瑞士军刀

**2023 年 3 月**，Georgi Gerganov 用 1500 行 C++ 写了 llama.cpp——一个能在 CPU 上跑 LLM 的工具。

### 它为什么牛？

1. **跨平台**：Mac (Metal) / Linux / Windows / iPhone / Raspberry Pi 全能跑。
2. **省内存**：通过 quantization 把 70B 模型压进 48GB 内存。
3. **速度尚可**：M2 Max MacBook 跑 Llama 3.3 70B 4-bit 大约 8 tok/s。
4. **零依赖**：单一 C++ 二进制，不要 Python，不要 CUDA。

### 用法

```bash
# 编译（Mac）
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make

# 下载模型（GGUF 格式）
huggingface-cli download bartowski/Llama-3.3-70B-Instruct-GGUF \
    Llama-3.3-70B-Instruct-Q4_K_M.gguf --local-dir ./models

# 跑
./llama-cli -m models/Llama-3.3-70B-Instruct-Q4_K_M.gguf \
    -p "你好，介绍一下你自己。"
```

或者起 HTTP server：

```bash
./llama-server -m models/Llama-3.3-70B-Instruct-Q4_K_M.gguf --port 8080
```

兼容 OpenAI API：

```bash
curl http://localhost:8080/v1/chat/completions \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

把 OpenAI 客户端的 base_url 改成 `http://localhost:8080/v1`，无缝替换。

### Ollama：llama.cpp 的"app 化"

llama.cpp 的友好包装。安装、模型管理、UI 一站式。

```bash
brew install ollama
ollama run llama3.3
```

适合"我就想试试"的场景。生产 / 高并发场景换 vLLM。

---

## 3. Quantization：怎么把 70B 模型塞进 48GB 显存？

原始的 70B 模型，FP16 精度，需要 **140GB** 显存（70 × 2 字节）。MacBook 顶配 M2 Ultra 也只有 192GB 统一内存，跑得动但其他事别干了。

**Quantization**（量化）把模型权重压缩——比如从 16-bit 浮点降到 4-bit 整数，模型大小减为 1/4。

### 主流 quantization 方案

#### GGUF（llama.cpp 用）

llama.cpp 的标准格式。多种精度级别：

| 量化级别 | 每参数比特 | 70B 模型大小 | 质量损失 |
|---|---|---|---|
| F16 (无量化) | 16 | 140GB | 0 |
| Q8_0 | 8 | 70GB | <1% |
| Q5_K_M | 5.5 | 48GB | 1-2% |
| Q4_K_M | 4.8 | 42GB | 2-4% |
| Q3_K_M | 3.9 | 32GB | 5-10% |
| Q2_K | 3.0 | 24GB | 显著 |

**实用经验**：Q4_K_M 是质量/大小的甜蜜点。Q3 以下质量明显下降。

#### GPTQ / AWQ（GPU 量化）

适合 NVIDIA GPU 推理。比 GGUF 优化得更激进：

- **GPTQ**：4-bit 量化，质量好，但需要校准数据
- **AWQ**：Activation-aware Weight Quantization，对重要权重保留更高精度

vLLM / SGLang 主要用这俩。

#### FP8 / BitsAndBytes

NVIDIA H100 支持 FP8 训练 / 推理。是新一代的"原生 8-bit"。

### Quantization 的代价

- **精度损失**：通常 1-5%，特定任务可能更多（数学、代码对量化敏感）
- **数值稳定性**：极端 prompt 下 quantized 模型容易输出乱码
- **支持有限**：某些功能（如 reasoning thinking）量化版可能失效

---

## 4. vLLM：生产级推理引擎

llama.cpp 适合 single user。生产服务需要**高并发**。这就是 **vLLM** 的场景。

vLLM 是 UC Berkeley 2023 年发的开源推理引擎。

### 核心技术：PagedAttention

传统推理引擎给每个 request 预留连续显存。短 request 浪费、长 request 撑爆。

PagedAttention 借鉴操作系统的虚拟内存——把显存切成小 page，按需分配。结果：

```
传统:   单 H100 服务 8 并发
vLLM:   单 H100 服务 80 并发
```

**10× 吞吐**。这是 vLLM 杀手锏。

### 用法

```bash
pip install vllm

# 起 server (兼容 OpenAI API)
vllm serve meta-llama/Llama-3.3-70B-Instruct \
    --tensor-parallel-size 2 \
    --gpu-memory-utilization 0.9
```

`--tensor-parallel-size 2` 意思是把模型分到 2 张 GPU 上。

### 速度对比

```
单卡 A100 跑 Llama 3.1 8B:
  llama.cpp:  60 tok/s  (单用户)
  vLLM:      200 tok/s  (8 并发各 200 = 总吞吐 1600 tok/s)
```

**结论**：单用户 llama.cpp，多用户 vLLM。

---

## 5. SGLang / TGI / LMDeploy：其他推理引擎

### SGLang（2024）

LMSYS 的开源引擎。和 vLLM 相比：

- **RadixAttention**：相同 prefix 的 prompt 共享 KV cache。RAG / few-shot 场景特别快。
- **Structured Output 优化**：JSON / regex constrained decoding 比 vLLM 快很多。
- 总吞吐 vs vLLM：略快一点。

### TGI (Text Generation Inference, HuggingFace)

HuggingFace 出品。功能全，但维护节奏比 vLLM 慢。

### LMDeploy（上海人工智能实验室）

国产，对中文模型（InternLM、Qwen）优化好。

### 怎么选？

```
通用场景:           vLLM
RAG / structured:   SGLang
HF 生态深度集成:    TGI
中文模型重度用户:   LMDeploy
```

---

## 6. 硬件配置参考（2026）

### 入门：单卡推理小模型

- **目标**：跑 7B-13B 模型，单用户
- **硬件**：MacBook M3 Pro / RTX 4090 / RTX 5090
- **工具**：Ollama / llama.cpp
- **预算**：$2000-3000

### 中阶：单卡 / 多卡推理中型模型

- **目标**：跑 70B 量化版，多并发
- **硬件**：2× RTX 4090 / 单 H100 / Mac Studio M2 Ultra
- **工具**：vLLM / SGLang
- **预算**：$10K-30K

### 高阶：跑 405B / DeepSeek-V3

- **目标**：跑前沿开源模型
- **硬件**：4-8× H100 / H200
- **工具**：vLLM + tensor parallel
- **预算**：$300K-500K（机器） 或 云上按时租

### 训练（fine-tune）

更贵。LoRA fine-tune 70B 模型至少 4× H100。Full fine-tune 要 16-32 张 H100。

---

## 7. 本地模型用什么场景？

不是所有场景都适合本地。一个粗糙的决策树：

```
日均 token 用量 < 1M:                     → 用 API
日均 > 10M + 高并发:                       → 本地 (vLLM)
有数据隐私要求:                           → 必须本地
需要 fine-tune:                           → 必须本地
需要极致 reasoning / 多模态前沿能力:        → 还得用闭源 API (前沿差距还在)
高频简单任务（分类、提取、改写）:           → 本地小模型省钱
低频复杂任务（agent、推理、创作）:          → API 划算
```

> 一句你可以拿去吹的话：
> **2024 年的本地模型已经能干 80% 闭源 API 能干的活，成本只有 1/10。剩下的 20% 难任务，目前还是闭源前沿领先。**

---

## 8. 一个真实部署示例

假设你要做一个内部 RAG 系统，2000 员工，每天大约 500K token 调用：

### 方案 A：纯 API

```
GPT-4o input/output 综合 ≈ $10 / 1M token
500K tok/天 × 30 = 15M tok/月
月成本: $150
```

便宜。但数据要发给 OpenAI。

### 方案 B：本地 vLLM

```
硬件: 1× H100 80GB ≈ $30000，3 年折旧 ≈ $833/月
机房 / 电力 ≈ $200/月
DevOps 时间 ≈ $500/月
模型: Llama 3.3 70B + Qwen 2.5 32B
吞吐: 单 H100 可服务 ~50 并发，足够 2000 员工

月成本: ~$1500
```

3 年总成本：~$54000

如果你团队 2000 人，**B 比 A 一年贵 $15K，但换来数据 100% 自主控制 + 可定制**。中型公司很多选 B。

---

## 9. 给你的小作业

1. **在自己 Mac 上装 Ollama，跑一个 7B 模型。测速记下 tok/s。**
2. **解释 quantization 怎么把 70B 模型塞进 48GB 显存。**
3. **如果一家初创公司要做 AI 客服，2 个工程师 + 100 用户，本地还是 API？给三个理由。**

> **下一篇钩子**：到这里我们都在讲文字。
> 但人类的世界不只是文字——还有图、视频、声音、3D。
> 怎么让 LLM 看图、听声、理解视频？这就是**多模态**。
> 下一篇我们讲，图像、音频、视频是怎么被"翻译"进 token 空间的。
