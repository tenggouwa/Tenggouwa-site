import { describe, expect, it } from 'vitest';
import { applyFilters, makePattern, presetOptions, rgbHex } from './perlerPattern';

describe('perler pattern', () => {
  it('量化后每个格子都引用调色板中的颜色编号', () => {
    const result = makePattern(
      [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 0 }],
      2,
      2,
      3,
    );
    expect(result.palette).toHaveLength(3);
    expect(result.counts.reduce((total, count) => total + count, 0)).toBe(4);
    expect(result.cells.every((cell) => cell.colorId >= 0 && cell.colorId < result.palette.length)).toBe(true);
  });

  it('滤镜预设和 hex 转换可预测', () => {
    expect(applyFilters({ r: 100, g: 100, b: 100 }, { preset: 'original', ...presetOptions('original') })).toEqual({ r: 100, g: 100, b: 100 });
    expect(rgbHex({ r: 90, g: 247, b: 142 })).toBe('#5AF78E');
  });
});
