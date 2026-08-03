export const COLOR_COUNTS = [24, 48, 72, 120, 144, 216, 272] as const;

export type FilterPreset = 'original' | 'vivid' | 'warm' | 'cartoon' | 'mono';

export interface FilterOptions {
  preset: FilterPreset;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PatternCell extends Rgb {
  colorId: number;
}

export interface PatternResult {
  width: number;
  height: number;
  cells: PatternCell[];
  palette: Rgb[];
  counts: number[];
}

const PRESETS: Record<FilterPreset, Pick<FilterOptions, 'brightness' | 'contrast' | 'saturation'>> = {
  original: { brightness: 0, contrast: 0, saturation: 0 },
  vivid: { brightness: 4, contrast: 10, saturation: 24 },
  warm: { brightness: 3, contrast: 4, saturation: 12 },
  cartoon: { brightness: 5, contrast: 18, saturation: 30 },
  mono: { brightness: 4, contrast: 12, saturation: -100 },
};

export function presetOptions(preset: FilterPreset): Pick<FilterOptions, 'brightness' | 'contrast' | 'saturation'> {
  return PRESETS[preset];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function applyFilters(pixel: Rgb, options: FilterOptions): Rgb {
  const brightness = options.brightness * 2.55;
  const contrast = 1 + options.contrast / 100;
  const saturation = 1 + options.saturation / 100;
  const r = (pixel.r - 128) * contrast + 128 + brightness;
  const g = (pixel.g - 128) * contrast + 128 + brightness;
  const b = (pixel.b - 128) * contrast + 128 + brightness;
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
  return {
    r: clamp(luminance + (r - luminance) * saturation),
    g: clamp(luminance + (g - luminance) * saturation),
    b: clamp(luminance + (b - luminance) * saturation),
  };
}

function distance(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function initialCentroids(pixels: Rgb[], colorCount: number): Rgb[] {
  const centroids: Rgb[] = [pixels[0]];
  while (centroids.length < colorCount) {
    let next = pixels[0];
    let farthest = -1;
    for (const pixel of pixels) {
      const nearest = Math.min(...centroids.map((centroid) => distance(pixel, centroid)));
      if (nearest > farthest) {
        farthest = nearest;
        next = pixel;
      }
    }
    centroids.push(next);
  }
  return centroids.map((pixel) => ({ ...pixel }));
}

export function makePattern(pixels: Rgb[], width: number, height: number, requestedColors: number): PatternResult {
  if (pixels.length !== width * height || pixels.length === 0) throw new Error('图片像素数据无效');
  const colorCount = Math.min(requestedColors, pixels.length);
  let palette = initialCentroids(pixels, colorCount);
  let assignments = new Array<number>(pixels.length).fill(0);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = palette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    assignments = pixels.map((pixel) => {
      let closest = 0;
      let closestDistance = Infinity;
      palette.forEach((color, index) => {
        const candidate = distance(pixel, color);
        if (candidate < closestDistance) {
          closestDistance = candidate;
          closest = index;
        }
      });
      const sum = sums[closest];
      sum.r += pixel.r;
      sum.g += pixel.g;
      sum.b += pixel.b;
      sum.count += 1;
      return closest;
    });
    palette = palette.map((color, index) => {
      const sum = sums[index];
      return sum.count ? { r: clamp(sum.r / sum.count), g: clamp(sum.g / sum.count), b: clamp(sum.b / sum.count) } : color;
    });
  }

  const counts = palette.map(() => 0);
  const cells = assignments.map((colorId) => {
    counts[colorId] += 1;
    return { ...palette[colorId], colorId };
  });
  const used = palette.map((color, colorId) => ({ color, count: counts[colorId] })).filter(({ count }) => count > 0);
  const ordered = used.sort((a, b) => b.count - a.count);
  const remap = new Map<number, number>();
  ordered.forEach(({ color }, index) => remap.set(palette.indexOf(color), index));
  return {
    width,
    height,
    palette: ordered.map(({ color }) => color),
    counts: ordered.map(({ count }) => count),
    cells: cells.map((cell) => ({ ...cell, colorId: remap.get(cell.colorId) ?? cell.colorId })),
  };
}

export function rgbHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
