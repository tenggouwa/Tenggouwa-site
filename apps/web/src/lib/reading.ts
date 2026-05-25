// 估算阅读时间。中文 ~300 字/分钟，英文 ~250 词/分钟，代码块按 0.5x 折扣
// （代码不是"读"是"扫"——但留点缓冲）

export function estimateReadingMinutes(markdown: string): number {
  // 分离代码块和正文
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) ?? [];
  const codeChars = codeBlocks.join('').length;
  const proseChars = markdown.length - codeChars;

  // 中文字符按一个一个算，英文按粗略 5 字符/词
  // 简化：300 字/分钟（含混合文本经验值），代码 600 chars/分钟
  const minutes = proseChars / 300 + codeChars / 600;
  return Math.max(1, Math.round(minutes));
}
