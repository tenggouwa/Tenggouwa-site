# AI 系列学习路径

> 目标：把 AI 学透。
> 节奏：由浅入深 + 时间线锚点 + 趣味比喻。
> 产物：每篇一份 markdown 源文件，发布到个人 blog。

## 写作 / 发布路径

- 草稿放在 `content/posts/ai-series/`，命名 `NN-slug.md`（`NN` 两位顺序号）。
- frontmatter 字段与后端 `PostCreate`（[apps/server/app/modules/posts/schema.py](apps/server/app/modules/posts/schema.py)）一一对应：

  ```yaml
  ---
  slug: what-is-ai-and-where-did-it-come-from
  title: AI 是什么？又是从哪冒出来的？
  summary: 一句话摘要，最多 500 字符
  tags: [ai, 入门, 时间线]
  published_at: 2026-05-22
  ---
  ```

- 发布方式（短期）：手动复制正文到 admin 后台。
- 发布方式（长期）：补一个 `scripts/publish-post.ts`，读 frontmatter + 正文 → 拿 admin token → POST `/api/admin/posts`。

## 写作约定

- **由浅入深**：从生活化比喻起步，再上术语；先讲"它在做什么"，再讲"它怎么做"，最后才是"它为什么 work"。
- **时间线**：每篇主线尽量挂在历史节点上（年份 + 论文 / 事件），形成可串起来的脉络。
- **趣味性**：terminal 风站点 → 多用 `$ command` 段子、代码片段、表格对照；少 textbook 腔。
- **每篇结尾**：留一个钩子 / 一个开放问题，引向下一篇。
- **长度**：3000–6000 字中文（约 8–15 分钟阅读）。

## 学习路线（活页清单，随写随调）

### Part 1 —— 是什么 / 从哪来（脉络）

- [x] 01 —— AI 是什么？又是从哪冒出来的？（达特茅斯 → 寒冬 → 深度学习 → 大模型，先把时间线立起来）
- [ ] 02 —— 三大流派世仇：符号主义、联结主义、统计学习（为什么今天是"联结主义 + 统计"赢了）
- [ ] 03 —— 神经网络是怎么"学"的：梯度下降 / 反向传播的直觉版（拿"下山找最低点"打比方）

### Part 2 —— 现代深度学习的几块基石

- [ ] 04 —— 从感知机到 CNN：让机器看见（LeNet → AlexNet → ResNet，附 2012 ImageNet 那场地震）
- [ ] 05 —— 从 RNN 到 Transformer：让机器读懂顺序（2014 seq2seq → 2017 Attention is All You Need）
- [ ] 06 —— 词向量小史：one-hot → word2vec → embedding（"国王 - 男人 + 女人 ≈ 女王"是怎么发生的）

### Part 3 —— 大模型时代

- [ ] 07 —— GPT 家族进化论：GPT-1 / 2 / 3 / 3.5 / 4 / 4.5 都到底变了啥
- [ ] 08 —— Scaling Laws & 涌现：为什么"大力出奇迹"在 LLM 上真的成立
- [ ] 09 —— 训练管线全景：pretrain → SFT → RLHF / RLAIF → DPO（每一步在塞什么进模型）
- [ ] 10 —— Tokenizer 与 context window：模型眼里的世界长什么样
- [ ] 11 —— 推理时优化：temperature、top-p、思维链、structured output、推理模型（o1 / R1 系）

### Part 4 —— 把模型用起来

- [ ] 12 —— Prompt engineering 的本质：你不是在写咒语，你是在压缩上下文
- [ ] 13 —— RAG：给模型外挂一个"知识硬盘"
- [ ] 14 —— Tool use / Function calling：模型怎么学会"打电话给真实世界"
- [ ] 15 —— Agent：从一次响应到一段"自主行动"（ReAct / Plan-and-Execute / Tree of Thoughts）
- [ ] 16 —— MCP & Agent SDK：今天构建 agent 的事实标准长啥样

### Part 5 —— 评估 / 安全 / 部署

- [ ] 17 —— Evals：怎么知道模型"真的变好了"而不是看起来变好了
- [ ] 18 —— 对齐与安全：有用、无害、诚实的工程化
- [ ] 19 —— 本地化部署：从 llama.cpp / vLLM 到自己跑个推理服务

### Part 6 —— 更深的水

- [ ] 20 —— 多模态：图、音、视频是怎么挤进 token 空间的
- [ ] 21 —— 世界模型 & 视频生成：Sora / Genie / V-JEPA 在赌一件什么事
- [ ] 22 —— 推理模型与 RL 的回归：o1 / R1 之后路通向哪
- [ ] 23 —— 开源生态与闭源前沿：Llama / Qwen / DeepSeek vs. Anthropic / OpenAI / Google 的牌面对比

每写完一篇，把上面对应行打勾，并在篇尾写下一篇的钩子。
