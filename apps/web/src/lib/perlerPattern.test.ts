import { describe, expect, it } from 'vitest';
import { applyFilters, cartoonizePixels, makePattern, mapPatternToBeads, presetOptions, rgbHex, type BeadColor } from './perlerPattern';

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

  it('卡通化会归并细碎色彩，且不会改变网格尺寸或颜色范围', () => {
    const result = cartoonizePixels(
      [{ r: 10, g: 20, b: 30 }, { r: 13, g: 22, b: 33 }, { r: 240, g: 230, b: 220 }, { r: 238, g: 228, b: 218 }],
      2,
      2,
      75,
    );
    expect(result).toHaveLength(4);
    expect(result.flatMap((pixel) => [pixel.r, pixel.g, pixel.b]).every((value) => value >= 0 && value <= 255)).toBe(true);
    expect(result).not.toEqual([{ r: 10, g: 20, b: 30 }, { r: 13, g: 22, b: 33 }, { r: 240, g: 230, b: 220 }, { r: 238, g: 228, b: 218 }]);
  });

  it('映射到实体色板后，格子编号和数量保持一致', () => {
    const source = makePattern(
      [{ r: 250, g: 20, b: 20 }, { r: 245, g: 25, b: 25 }, { r: 20, g: 20, b: 245 }, { r: 20, g: 20, b: 245 }],
      2,
      2,
      2,
    );
    const beads: BeadColor[] = [
      { code: 'RED', name: '红', brand: '测试', r: 255, g: 0, b: 0 },
      { code: 'BLUE', name: '蓝', brand: '测试', r: 0, g: 0, b: 255 },
    ];
    const result = mapPatternToBeads(source, beads);
    expect(result.palette.map((color) => color.code)).toEqual(['RED', 'BLUE']);
    expect(result.counts).toEqual([2, 2]);
    expect(result.cells.map((cell) => cell.colorId)).toEqual([0, 0, 1, 1]);
  });
});
