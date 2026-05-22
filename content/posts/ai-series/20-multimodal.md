---
slug: multimodal
title: 多模态：图、音、视频是怎么挤进 token 空间的
summary: AI 系列第 20 篇。LLM 只懂 token。怎么让它看图、听声、理解视频？答案是把所有模态都"翻译"进同一个 token 空间。这一篇讲 CLIP、Flamingo、GPT-4V、Whisper、Sora 是怎么把多种模态打通的，以及 2025-2026 年"原生多模态"为什么是新主流。
tags: [ai, multimodal, clip, vision, audio, ai-series]
published_at: 2026-06-10
---

> AI 系列第 20 篇。这一篇讲怎么让"只懂文字的 LLM"看见、听见、理解世界。

## 0. 一个根本困境

LLM 工作在 token 空间。每个 token 对应一个向量。Transformer 在这些向量上跑 attention。

**但图像怎么变成 token？声音呢？视频呢？**

天真的方案：把图像 base64 编码成字符串，让 LLM 读字符串。

不行。base64 字符串太长（一张图几十万字符），且模型完全没法从这种"伪文本"提取视觉信息。

真正的方案是 **联合表示**：把所有模态都映射到**同一个 embedding 空间**。这样 attention 才能跨模态工作。

```
text:  "一只猫" → text embedding → [v1, v2, ...]
image: 猫.jpg → image encoder → [u1, u2, ...]
                                      │
                          目标: v ≈ u
                          （描述同一件事的文本和图像，向量应该相似）
```

这一篇我们讲这件事怎么从 2021 走到 2026。

---

## 1. 2021 CLIP：让图像和文字"对齐"

**2021 年**，OpenAI 发了 **CLIP（Contrastive Language-Image Pre-training）**。这是多模态的奠基性工作。

### 训练目标：对齐图文对

收集 4 亿（图片, 描述）对，让模型学：

```
正样本: (猫.jpg, "一只在沙发上的橘猫")  → 距离近
负样本: (猫.jpg, "一辆红色跑车")      → 距离远
```

具体训练用 **contrastive loss**：

```
对一个 batch 里的 N 个图文对:
   有 N 个正样本 (image_i, text_i)
   有 N² - N 个负样本 (image_i, text_j) i≠j

   loss: 让正样本相似度高，负样本相似度低
```

训练完，得到两个 encoder：

- **Image encoder**：图 → 512 维向量
- **Text encoder**：文 → 512 维向量

**这俩向量在同一空间**。可以直接比较。

### CLIP 的神奇用法

#### 用法 1：零样本图像分类

```python
image = encode_image("猫.jpg")
labels = ["一只猫", "一只狗", "一辆车"]
text_embs = [encode_text(l) for l in labels]
predicted = labels[argmax(cosine_sim(image, text_embs))]
# → "一只猫"
```

不用训分类器，靠"和文本相似度"就能分类。**当时震惊全场**。

#### 用法 2：图像检索

```
query: "一张日落的照片"
→ 找数据库里和这个文本 embedding 最近的图片
```

Pinterest / Unsplash 的"搜图"基本都是这套。

#### 用法 3：作为下游模型的视觉骨干

CLIP 的 image encoder 可以接到任何下游网络。Stable Diffusion、GPT-4V、LLaVA 全都用 CLIP（或其变种）当视觉前端。

> 一句你可以拿去吹的话：
> **CLIP 不是"多模态模型"，它是让所有后续多模态模型成为可能的**基础设施**。**

---

## 2. 2022 Flamingo / 2023 GPT-4V：把视觉嫁接到 LLM

CLIP 解决了"图文对齐"。但还差一步——让 LLM 在对话中**理解**图像。

```
你: [发一张图] "这张图里有什么？"
LLM: ???
```

要让 LLM 真的"懂图"，得把视觉信号接进 transformer 序列。

### Flamingo（2022 DeepMind）

把 CLIP image encoder 接到一个**冻结的 LLM**：

```
┌──────────────────────────────────────────────┐
│  prompt: <image1> 一只 <image2> 的            │
│                                              │
│  [image1] → CLIP encoder → 视觉 token            │
│  [image2] → CLIP encoder → 视觉 token            │
│  其他都是文本 token                            │
│                                              │
│  → 全部进入 transformer 一起处理              │
└──────────────────────────────────────────────┘
```

LLM 在原本的文本 token 序列里"插入"视觉 token。这种范式叫 **early fusion**。

Flamingo 第一次让 LLM 能在对话中混用图文。它启发了所有后续多模态对话模型。

### GPT-4V（2023）

OpenAI 在 GPT-4 基础上加入视觉能力。技术细节没公开，但推测是类似 Flamingo 的 early fusion + 视觉 encoder 微调到 LLM 兼容的 embedding 空间。

GPT-4V 能做的事比 Flamingo 强很多：

- 读手写、表格、图表
- 看代码截图找 bug
- 理解 meme、UI 截图
- 看几何题解题
- 从图片推断地理位置（甚至能猜出大致经纬度）

这彻底打开了"看图说话"这个产品形态。

### LLaVA / MiniGPT-4 / Qwen-VL（开源跟进）

CLIP + 开源 LLM，几个月就有了一堆开源多模态模型。今天主流的：

- **LLaVA-NeXT**：开源经典
- **Qwen-VL 2.5**：阿里，多语言强
- **InternVL 3**：上海人工智能实验室
- **Llama 3.2 11B/90B Vision**：Meta 官方

---

## 3. 音频：Whisper + 音频 token

### Whisper（OpenAI 2022）

只做语音 → 文字的 ASR 模型。68 万小时多语言音频训出来。

```
audio.wav → Whisper → "今天天气真好"
```

不属于"多模态 LLM"，但是后续多模态系统的标配前端：把音频转文字，再喂给 LLM。

### Audio embedding 路线

把音频也变成 token 进 LLM：

```
audio.wav → audio encoder → audio tokens → 进 transformer
```

主流方案：

- **Whisper encoder**：把语音抽成向量
- **Wav2vec 2.0** (Meta)：自监督音频表示
- **AudioLM / VALL-E**：把音频离散化成 token

### GPT-4o / Gemini：原生音频输入

**2024 年 GPT-4o** 是第一个**原生**多模态的大模型——文本、图像、音频在**同一个 transformer** 里。

```
GPT-4 (旧):
  audio → whisper → text → GPT-4 → text → TTS → audio
  延迟: 几秒
  
GPT-4o (新):
  audio → audio tokens → GPT-4o → audio tokens (流式)
  延迟: 320ms
  
  优势: 能保留情感、停顿、语调、笑声
```

这就是"原生多模态"——所有模态共享同一个模型，不通过文字桥接。

---

## 4. 视频：把时间维度也塞进去

视频 = 一连串图片 + 音频 + 字幕。挑战是 **数据量太大**：

```
30 分钟视频 (1080p, 30fps):
  ~ 54000 帧
  每帧编码 ~ 256 token (CLIP 风格)
  总共 ~ 1400 万 token
```

直接全塞进 context window 显然不行。

### 主流解法

#### 解法 1：稀疏采样

每秒抽 1 帧（甚至更少）。30 分钟视频变成 1800 帧 ≈ 50 万 token。配合 1M context 可以塞。

#### 解法 2：层次化压缩

每秒先抽 30 帧 → 局部 attention 压成一帧 → 再喂给上层。

#### 解法 3：时空 transformer

直接对 (T, H, W) 三维数据做 attention，而不是把每帧单独处理。

### Gemini 1.5：长视频 understanding 的代表

Gemini 1.5 Pro 在论文里展示了"看完一整部 1 小时电影后回答问题"。这是稀疏采样 + ring attention + 高效编码的综合结果。

### Sora / Veo / Kling：视频生成

反向问题——让模型**生成**视频。

```
prompt: "一只在月球上跳舞的猫，皮克斯风格"
→ 生成 10 秒视频
```

技术原理是 **diffusion in latent space**（潜空间扩散）：

1. 用 encoder 把视频压缩到低维潜空间
2. 在潜空间训 diffusion model
3. 用 decoder 把生成结果解码回视频

2024 OpenAI 的 Sora、Google 的 Veo、Kuaishou 的 Kling、字节的 Seedance 都是这条路。

下一篇会详细讲世界模型 / 视频生成。

---

## 5. 多模态的真实挑战

### 挑战 1：token 数量不平衡

```
1 张 1080p 图片:    ~ 1000 tokens
10 秒 1080p 视频:   ~ 30000 tokens
10 秒音频:          ~ 1500 tokens
1 千字文本:        ~ 1000 tokens
```

视频 token 占用是其他模态的几十倍。这是为什么视频理解一直是多模态最难的一环。

### 挑战 2：跨模态对齐数据稀缺

```
text-text 数据:     数万亿 token (整个互联网)
text-image 数据:    几十亿对 (CLIP 4 亿，LAION 50 亿)
text-audio 数据:    几亿对 (远少于图像)
text-video 数据:    几千万对 (更少，且质量差)
```

数据墙首先在视频和音频上撞到。

### 挑战 3：模态之间的"统治权"

LLM 训练时如果文字数据远多于图像/音频，**模型默认会偏向用文字思考**。需要专门设计训练课程让各模态平衡。

### 挑战 4：评估难

```
"这个回答是否准确?" - 文字回答好评
"这个图像描述是否准确?" - 难
"这个视频生成是否符合 prompt?" - 极难
```

视频生成 eval 还是开放问题。

---

## 6. 原生多模态 vs 拼接式

```
拼接式 (legacy):
  audio → whisper → text → LLM → text → TTS → audio
  
  特点: 模块化、容易实现、但损失信息

原生多模态 (modern):
  audio → audio tokens → 大模型 → 多模态 token (text + audio) → 多种输出
  
  特点: 信息保留完整、延迟低、训练复杂
```

**2024-2026 是从拼接式向原生的转折**。GPT-4o、Gemini 2、Claude 3.5+ 都在朝原生多模态走。

---

## 7. 多模态的几个杀手应用

### 应用 1：截图问答

```
"我看不懂这个表格，帮我解释一下。"
[上传截图]
```

GPT-4V / Claude 3.5 / Qwen-VL 都强。已经成为生产力工具标配。

### 应用 2：UI 理解 + 自动化

```
"打开这个 app 帮我订一杯咖啡。"
[截图当前界面]
```

Anthropic Claude Computer Use（2024.10）就是这套——多模态 + agent。

### 应用 3：内容生成

```
"画一张产品 demo 海报"
→ DALL-E / Midjourney / Stable Diffusion 3 / Flux
```

文字 → 图。文字 → 视频（Sora / Veo / Kling）。

### 应用 4：语音助手 2.0

```
GPT-4o Voice Mode:
  用户说话 → 实时打断 → 实时回答 → 带情感的语音输出
```

延迟降到 < 500ms，像和真人对话。

### 应用 5：视频字幕 / 总结

```
30 分钟会议录像 → 自动生成字幕 + 章节标题 + 行动项
```

Loom / Otter.ai / Fathom 都是这类。

---

## 8. 给你的小作业

1. **解释 CLIP 是怎么训出"图文共享 embedding 空间"的。用 contrastive loss 描述。**
2. **GPT-4o 比 GPT-4 + Whisper + TTS 的拼接版强在哪？至少三点。**
3. **如果你做一个 AI 漫画创作助手，需要哪些多模态能力？画一个 pipeline。**

> **下一篇钩子**：会看图、会听声、还不够。
> 下一个前沿——让 AI **理解物理世界**：物体怎么运动、重力怎么作用、人怎么交互。
> Sora 看似在"画视频"，背后藏着一个野心：建立 **world model**（世界模型）。
> 下一篇我们看 Sora / Genie / V-JEPA 这些"世界模型"项目在赌一件什么大事。
