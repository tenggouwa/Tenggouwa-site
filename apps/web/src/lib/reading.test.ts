import { describe, expect, it } from 'vitest';
import { estimateReadingMinutes } from './reading';

describe('estimateReadingMinutes', () => {
  it('空文本至少 1 分钟', () => {
    expect(estimateReadingMinutes('')).toBe(1);
  });

  it('短文本下取整到最小 1 分钟', () => {
    expect(estimateReadingMinutes('几个字')).toBe(1);
  });

  it('300 字正文约 1 分钟', () => {
    expect(estimateReadingMinutes('字'.repeat(300))).toBe(1);
  });

  it('900 字正文约 3 分钟', () => {
    expect(estimateReadingMinutes('字'.repeat(900))).toBe(3);
  });

  it('代码块按 600 chars/分钟折扣计', () => {
    // 600 字符代码块 → 1 分钟；同样长度正文则是 2 分钟
    const code = '```\n' + 'x'.repeat(594) + '\n```'; // fence 占 8 字符，总长 602
    const prose = 'x'.repeat(602);
    expect(estimateReadingMinutes(code)).toBeLessThan(estimateReadingMinutes(prose));
  });

  it('正文与代码块混合分别计时', () => {
    const markdown = '字'.repeat(600) + '\n```\n' + 'x'.repeat(600) + '\n```';
    // 正文 600/300=2 + 代码 ~608/600≈1 → round(3.x)
    expect(estimateReadingMinutes(markdown)).toBeGreaterThanOrEqual(3);
  });
});
