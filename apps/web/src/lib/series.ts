// 系列元信息：tag → 展示信息。给 Series 落地页 + PostDetail 顶部"属于系列"用。
// 写在前端常量里，添加新系列只需要在这里加一项 + 文章 frontmatter 加对应 tag。

import type { SeriesMeta } from './types';

// AI 系列完整路线图。已发布按 published_at <= now() 自动激活；未来稿在 landing
// 页显示"排队中 · YYYY-MM-DD"占位 —— 让读者看见"还有多少要更"，提升回访。
// 顺序 = 阅读顺序，发布日期与 content/posts/ai-series/*.md frontmatter 对齐。
const AI_ROADMAP = [
  { part: 'Part 1 — 是什么 / 从哪来',     slug: 'what-is-ai-and-where-did-it-come-from',  title: 'AI 是什么？又是从哪冒出来的？',                published_at: '2026-05-22' },
  { part: 'Part 1 — 是什么 / 从哪来',     slug: 'three-schools-of-ai',                    title: '三大流派世仇：符号 · 联结 · 统计',              published_at: '2026-05-23' },
  { part: 'Part 1 — 是什么 / 从哪来',     slug: 'how-neural-nets-learn',                  title: '神经网络是怎么"学"的：梯度下降与反向传播',       published_at: '2026-05-24' },
  { part: 'Part 2 — 现代深度学习的基石',   slug: 'from-perceptron-to-cnn',                 title: '从感知机到 CNN：让机器看见',                   published_at: '2026-05-25' },
  { part: 'Part 2 — 现代深度学习的基石',   slug: 'from-rnn-to-transformer',                title: '从 RNN 到 Transformer：让机器读懂顺序',         published_at: '2026-05-26' },
  { part: 'Part 2 — 现代深度学习的基石',   slug: 'word-vectors',                           title: '词向量小史：从 one-hot 到 embedding',          published_at: '2026-05-27' },
  { part: 'Part 3 — 大模型时代',          slug: 'gpt-family',                             title: 'GPT 家族进化论',                              published_at: '2026-05-28' },
  { part: 'Part 3 — 大模型时代',          slug: 'scaling-laws-and-emergence',             title: 'Scaling Laws & 涌现',                         published_at: '2026-05-29' },
  { part: 'Part 3 — 大模型时代',          slug: 'training-pipeline',                      title: '训练管线全景：pretrain → SFT → RLHF / DPO',     published_at: '2026-05-30' },
  { part: 'Part 3 — 大模型时代',          slug: 'tokenizer-and-context',                  title: 'Tokenizer 与 context window',                 published_at: '2026-05-31' },
  { part: 'Part 3 — 大模型时代',          slug: 'inference-time-knobs',                   title: '推理时优化：temperature / top-p / CoT / 推理模型', published_at: '2026-06-01' },
  { part: 'Part 4 — 把模型用起来',        slug: 'prompt-engineering',                     title: 'Prompt Engineering 的本质',                    published_at: '2026-06-02' },
  { part: 'Part 4 — 把模型用起来',        slug: 'rag',                                    title: 'RAG：给模型外挂一个"知识硬盘"',                published_at: '2026-06-03' },
  { part: 'Part 4 — 把模型用起来',        slug: 'tool-use',                               title: 'Tool Use / Function Calling',                 published_at: '2026-06-04' },
  { part: 'Part 4 — 把模型用起来',        slug: 'agent',                                  title: 'Agent：从一次响应到一段自主行动',              published_at: '2026-06-05' },
  { part: 'Part 4 — 把模型用起来',        slug: 'mcp-and-agent-sdk',                      title: 'MCP & Agent SDK',                             published_at: '2026-06-06' },
  { part: 'Part 5 — 评估 / 安全 / 部署',  slug: 'evals',                                  title: 'Evals：怎么知道模型真的变好了',                published_at: '2026-06-07' },
  { part: 'Part 5 — 评估 / 安全 / 部署',  slug: 'alignment-and-safety',                   title: '对齐与安全：HHH 的工程化',                     published_at: '2026-06-08' },
  { part: 'Part 5 — 评估 / 安全 / 部署',  slug: 'local-deployment',                       title: '本地化部署：llama.cpp / vLLM / quantization',  published_at: '2026-06-09' },
  { part: 'Part 6 — 更深的水',            slug: 'multimodal',                             title: '多模态：图 / 音 / 视频怎么挤进 token 空间',     published_at: '2026-06-10' },
  { part: 'Part 6 — 更深的水',            slug: 'world-models',                           title: 'World Model & 视频生成：Sora / Genie / V-JEPA', published_at: '2026-06-11' },
  { part: 'Part 6 — 更深的水',            slug: 'reasoning-and-rl',                       title: '推理模型与 RL 的回归：o1 / R1 之后',            published_at: '2026-06-12' },
  { part: 'Part 6 — 更深的水',            slug: 'open-vs-frontier',                       title: '开源生态 vs 闭源前沿：2026 牌面对比（终篇）',   published_at: '2026-06-13' },
];

export const SERIES: SeriesMeta[] = [
  {
    tag: 'ai-series',
    title: 'AI 系列',
    command_hint: 'man ai',
    description:
      '从 1950 年的人工神经元一路串到今天能跟你聊天的大模型 —— 23 篇把 AI 这条线讲透。' +
      '不堆数学、不背名词，用一条时间线 + 一堆具体例子，让"AI / ML / DL / LLM / Agent"在你脑中各归各位。',
    roadmap: AI_ROADMAP,
  },
  {
    tag: 'linux-series',
    title: 'Linux 系列',
    command_hint: 'man linux',
    description:
      '把 Linux 学到能"住下来"——不管是 VPS、Docker、WSL、还是树莓派，' +
      '打开终端就有家的感觉。25 篇按章节循序渐进：心智模型 → shell 工具 → 文件权限 → 进程 → 网络 → 性能 → 容器。',
  },
];

export function seriesForTags(tags: string[]): SeriesMeta | null {
  for (const tag of tags) {
    const found = SERIES.find((s) => s.tag === tag);
    if (found) return found;
  }
  return null;
}

export function getSeries(tag: string): SeriesMeta | null {
  return SERIES.find((s) => s.tag === tag) ?? null;
}
