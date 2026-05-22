---
slug: world-models
title: 世界模型 & 视频生成：Sora / Genie / V-JEPA 在赌什么
summary: AI 系列第 21 篇。Sora 看似在"画视频"，背后真正的野心是建立 world model（世界模型）——一个能"理解物理"的 AI。这一篇讲 LeCun 的 V-JEPA、Sora 的扩散路线、DeepMind Genie 的生成式游戏世界，以及"世界模型"这个概念为什么是下一个十年的 AI 主战场。
tags: [ai, world-model, sora, video-generation, ai-series]
published_at: 2026-06-11
---

> AI 系列第 21 篇。这一篇讲一个还在赌的大事——**world model**。
> 这是 LLM 之后 AI 最被看好的下一个 paradigm。

## 0. 一个 LLM 永远赢不了的问题

```
你: "把这个杯子从桌子边推下去会发生什么？"

LLM: "杯子会掉到地上，可能摔碎，洒出里面的液体。"
```

听起来 LLM 懂物理。但 ——

```
你: "如果桌子是橡胶做的，杯子用 5g 的力推呢？"

LLM: "杯子会掉下去......" (但其实推不动)

你: "如果杯子是磁铁的，桌子是铁的呢？"

LLM: "嗯……可能不会掉。" (蒙对)
```

LLM 的"物理常识"是从文字里学的——它知道"杯子会掉"是因为读过几千万次类似描述。**它不真的理解重力、摩擦、磁力**。

这个问题在文字任务上不重要。但要让 AI 操作真实世界（机器人、自动驾驶、虚拟环境），必须解决。

这就是 **world model**（世界模型）想做的事。

---

## 1. World Model 是什么

> **World model = 一个能预测"如果做某动作，世界会怎么变"的模型。**

形式化：

```
输入: 当前状态 s_t + 动作 a_t
输出: 下一状态 s_{t+1}
```

人脑里就有 world model。你看到一个杯子放在桌边，你**预测**推它会掉。你看到马上要下雨，你**预测**需要带伞。这种预测能力是智能的核心。

LLM 是 **language model**——它预测的是下一个 **token**。
World model 预测的是下一个 **世界状态**——可能是图像、视频帧、传感器读数、3D 点云。

### 为什么 world model 重要？

1. **机器人**：要让机器人在物理世界里规划动作，它必须能预测动作后果。
2. **自动驾驶**：要安全决策，必须模拟 "如果我刹车 / 转弯 / 加速会怎样"。
3. **科学发现**：物理模拟、蛋白质折叠、气候建模本质都是 world model。
4. **更强的 AI**：很多研究者（如 LeCun）认为 LLM 是死路，world model 才是 AGI 的下一站。

---

## 2. LeCun 的论断：LLM 是岔路，World Model 是主路

Yann LeCun（Meta 首席 AI 科学家、图灵奖得主）多次公开说：

> "LLM 永远不可能达到人类智能水平。它们没有 grounding，不能理解物理，不能规划。"

他的论点：

1. LLM 从**文字**学习。文字是人类智能的**输出**，不是它的**基础**。
2. 人类婴儿不读书也能学会物理常识——通过**观察 + 行动**。
3. AI 要走通用智能，应该模仿婴儿——从**视觉 / 视频** + **行动** 中学习。

LeCun 提出的 **JEPA（Joint Embedding Predictive Architecture）** 是他赌的方向：

```
JEPA:
  学习一个能"预测视频未来帧的特征"的模型
  不预测像素，而是预测高层抽象表示
```

V-JEPA（2024）是 Meta 实现的视频版 JEPA。它不输出图像，输出抽象 representations。学到的能力包括：

- 物体连续性（被遮挡的东西还在）
- 重力、惯性的直觉
- 因果时序

LeCun 团队相信：**这种自监督视频学习，才是通往真正智能的路**。

> 一句你可以拿去吹的话：
> **LeCun 押 world model，OpenAI 押 scaling LLM。这两个押注会在未来 5-10 年见分晓。**

---

## 3. Sora：把视频生成变成"隐式 world model"

**2024 年 2 月**，OpenAI 发布 **Sora**——能生成 60 秒高清视频。

它和 V-JEPA 走的不是同一条路，但目标相通——**学会"世界怎么运动"**。

### Sora 的技术路线：DiT（Diffusion Transformer）

```
1. 把视频切成 3D patches (时空 patch)
2. 每个 patch 用 transformer encode 成 token
3. 用 diffusion model 在 token 空间生成新视频
4. decode 回像素
```

关键创新：**视频 = 一连串时空 patches**。这种统一表示让 Sora 能：

- 处理任意分辨率
- 处理任意时长
- 处理任意宽高比

### Sora 学到了什么？

OpenAI 的论文标题就是 **Video generation models as world simulators**——它声明 Sora 不只是"会画视频"，而是"会模拟世界"。

```
生成结果展现的能力:
- 3D consistency  (镜头移动时，物体相对位置正确)
- 物体持久性     (被遮挡后还能正确出现)
- 物理直觉       (重力、惯性、流体)
- 数字时序       (倒咖啡，杯子里液体会增加)
- 简单因果       (刀切番茄，番茄会分开)
```

但也有大量 failure case：

```
- 一只猫的腿有时会变成 4 只
- 玻璃杯打碎后画面卡顿
- 文字 / 数字几乎肯定生成错
- 角色身份在镜头切换后变化
```

**Sora 学的物理还不完整**。但相比 2022 的 video generation，进步是质变级的。

### Veo / Kling / Seedance：开源 / 中国跟进

2024-2025 这一年视频生成跑得飞快：

- **Google Veo 2**：电影级质感
- **Kuaishou Kling 2**：中国开源
- **字节 Seedance**：消费端集成
- **Runway Gen-3 / Gen-4**：好莱坞工具链
- **Pika 2**：创作者社区

---

## 4. DeepMind Genie：生成式游戏世界

**2024 年 2 月**，DeepMind 发了 **Genie**——能从一张静态图生成可玩的 2D 游戏世界。

```
输入: 一张图片 (草地 + 角色)
输出: 一个交互式环境
  用户按 → → 角色向右走
  用户按 ↑ → 角色跳跃
  整个世界根据操作连续演化
```

Genie 训练用的是**纯视频**——它从大量游戏视频里学到了"动作 → 后果"的隐式 mapping。

Genie 2（2024.12）升级到 3D，时长更长，物理更真。

### Genie 的意义

它不是为了娱乐。它在示范一件事：**纯靠视频，可以学到通用的 "action → world change" 映射**。这是 world model 的核心能力。

如果这条路 work，AI 可以：

- 在虚拟环境里训机器人（不用真摔几千个机器人）
- 模拟自动驾驶场景（不用真撞几百辆车）
- 模拟蛋白质折叠 / 化学反应 / 经济市场

---

## 5. World Model 在机器人上的应用

机器人是 world model 最直接的应用场景。

### 传统机器人控制

```
传感器 → 状态估计 → 规划器 (基于物理引擎) → 控制器
```

物理引擎是手工编写的——重力、摩擦、刚体动力学等都被显式编码。

### Learned world model 路线

```
传感器 → 学到的 world model → 规划器
                   ↑
              纯从经验里学
```

不写物理引擎，让模型从大量交互数据里学。代表项目：

- **Google PaLM-E**：把视觉 + 语言 + 机器人控制统一到一个模型
- **Google RT-2**：Robotic Transformer，从视频学到操作策略
- **Figure AI / 1X / Tesla Optimus**：人形机器人，背后都有 world model

### Sim-to-Real Transfer

挑战之一：模型在仿真里训出来的能力，搬到真实世界往往效果打折。原因是仿真和真实的物理细节有差异。

解决思路：
- **Domain randomization**：仿真时随机化各种参数，强迫模型 robust
- **Real-world fine-tuning**：仿真预训练 + 真机 fine-tune
- **Foundation model + RL**：在大规模预训练基础上，少量真机数据 fine-tune

---

## 6. World Model 真正的难点

### 难点 1：长程预测

视频生成 5 秒还行，1 分钟就开始失真。100 秒后几乎完全跑偏。

原因：误差累积。每一步预测有小误差，几十步后误差爆炸。

### 难点 2：稀有事件

物理世界 99% 时间是平凡的（杯子静静地放着）。但**安全关键的 1%**（杯子要倒了、车要撞了）才是 world model 真正需要预测对的。

训练数据天然缺乏稀有事件 → 模型对稀有事件预测不准。

### 难点 3：因果 vs 相关

视频里"闪电之后下雨" 99% 会同时出现。模型学到的是"闪电 → 下雨"，但真正的因果是"积雨云 → 闪电 + 下雨"。

这种**伪因果**会让 world model 在反事实预测（counterfactual）上犯傻。

### 难点 4：评估

video 生成模型怎么评？人工标？太贵。FID 之类的图像指标？衡量像素相似度，但不评物理对错。

到 2026 年，没有一个公认的 world model evaluation 标准。这本身就是个研究问题。

---

## 7. World Model vs LLM：会取代还是融合？

主流声音有三种：

### 声音 1：World model 替代 LLM（LeCun 派）

理由：LLM 撞了 scaling 墙。下一代智能需要 grounding。

### 声音 2：LLM + World model 互补（多数实验室）

理由：
- LLM 擅长抽象推理、知识
- World model 擅长物理、低层控制
- 两者各管一摊

OpenAI / Anthropic 都在做 multimodal LLM + world model 的融合。Sora 本身就是这种融合的早期形态。

### 声音 3：World model 是 LLM 的特例

理由：广义来说，"预测下一个 token" 也是预测世界（语言世界）的下一状态。只要 token 涵盖了视觉、音频、动作，LLM 框架就能装下 world model。

GPT-4o / Gemini 走这条路——把视频、音频、动作都 tokenize，用同一个 transformer 训。

我自己倾向**声音 2-3 之间**——架构上会统一，但需要专门的数据 / 训练课程让模型真的学到物理。

> 一句你可以拿去吹的话：
> **未来 5 年 AI 的主战场，从 "更大的 LLM" 转向 "能理解物理的多模态系统"。LLM 是入场券，world model 才是主菜。**

---

## 8. 给你的小作业

1. **解释 world model 为什么对机器人比对聊天机器人更重要。**
2. **Sora 生成视频"看起来真"但物理不完全对——给三个具体 failure case。**
3. **如果让你判断"模型真的懂物理"，你会设计什么样的 evals？给三个例子。**

> **下一篇钩子**：world model 在赌"AI 要理解世界"。
> 还有另一条同样重要的赌 —— "AI 要学会推理"。
> 2024 OpenAI o1 / 2025 DeepSeek R1 / Claude with thinking 都在这条路上。
> 下一篇我们看 reasoning model 是怎么训出来的，以及 RL 在 LLM 时代为什么"回来了"。
