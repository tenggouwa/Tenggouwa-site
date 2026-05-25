// 系列元信息：tag → 展示信息。给 Series 落地页 + PostDetail 顶部"属于系列"用。
// 写在前端常量里，添加新系列只需要在这里加一项 + 文章 frontmatter 加对应 tag。

import type { SeriesMeta } from './types';

export const SERIES: SeriesMeta[] = [
  {
    tag: 'ai-series',
    title: 'AI 系列',
    command_hint: 'man ai',
    description:
      '从 1950 年的人工神经元一路串到今天能跟你聊天的大模型 —— 23 篇把 AI 这条线讲透。' +
      '不堆数学、不背名词，用一条时间线 + 一堆具体例子，让"AI / ML / DL / LLM / Agent"在你脑中各归各位。',
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
