import { describe, expect, it } from 'vitest';
import { getSeries, seriesForTags, SERIES } from './series';

describe('getSeries', () => {
  it('已知 tag 返回对应系列', () => {
    expect(getSeries('ai-series')?.title).toBe('AI 系列');
    expect(getSeries('linux-series')?.title).toBe('Linux 系列');
  });

  it('未知 tag 返回 null', () => {
    expect(getSeries('nope')).toBeNull();
  });
});

describe('seriesForTags', () => {
  it('命中第一个匹配的系列 tag', () => {
    expect(seriesForTags(['foo', 'ai-series', 'bar'])?.tag).toBe('ai-series');
  });

  it('多个系列 tag 时取数组里先出现的', () => {
    expect(seriesForTags(['linux-series', 'ai-series'])?.tag).toBe('linux-series');
  });

  it('无匹配返回 null', () => {
    expect(seriesForTags(['foo', 'bar'])).toBeNull();
  });

  it('空数组返回 null', () => {
    expect(seriesForTags([])).toBeNull();
  });
});

describe('SERIES 常量自洽', () => {
  it('每个系列 tag 唯一', () => {
    const tags = SERIES.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('ai-series roadmap 的 slug 不重复', () => {
    const ai = getSeries('ai-series');
    const slugs = ai?.roadmap?.map((r) => r.slug) ?? [];
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
