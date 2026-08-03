import { useCallback, useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';
import {
  COLOR_COUNTS,
  applyFilters,
  makePattern,
  presetOptions,
  rgbHex,
  type FilterOptions,
  type FilterPreset,
  type PatternResult,
  type Rgb,
} from '../../lib/perlerPattern';

const BOARD_SIZES = [14, 29, 58] as const;
const MAX_FILE_SIZE = 12 * 1024 * 1024;

function rgbCss(color: Rgb): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function drawPattern(canvas: HTMLCanvasElement, pattern: PatternResult, withNumbers: boolean) {
  const cellSize = Math.max(20, Math.min(36, Math.floor(1440 / Math.max(pattern.width, pattern.height))));
  canvas.width = pattern.width * cellSize;
  canvas.height = pattern.height * cellSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0f10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(8, Math.floor(cellSize * 0.42))}px monospace`;
  pattern.cells.forEach((cell, index) => {
    const x = (index % pattern.width) * cellSize;
    const y = Math.floor(index / pattern.width) * cellSize;
    ctx.fillStyle = rgbCss(cell);
    ctx.fillRect(x, y, cellSize, cellSize);
    ctx.strokeStyle = 'rgba(11, 15, 16, 0.45)';
    ctx.strokeRect(x, y, cellSize, cellSize);
    if (withNumbers) {
      const lightness = cell.r * 0.299 + cell.g * 0.587 + cell.b * 0.114;
      ctx.fillStyle = lightness > 150 ? '#0b0f10' : '#ffffff';
      ctx.fillText(String(cell.colorId + 1), x + cellSize / 2, y + cellSize / 2 + 0.5);
    }
  });
}

async function readImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M12 16V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

export default function PerlerPattern() {
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [board, setBoard] = useState<number>(29);
  const [colorCount, setColorCount] = useState<(typeof COLOR_COUNTS)[number]>(48);
  const [filters, setFilters] = useState<FilterOptions>({ preset: 'original', ...presetOptions('original') });
  const [numbers, setNumbers] = useState(true);
  const [pattern, setPattern] = useState<PatternResult | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (canvasRef.current && pattern) drawPattern(canvasRef.current, pattern, numbers);
  }, [numbers, pattern]);

  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  const createPattern = useCallback(() => {
    if (!image) return null;
    const source = document.createElement('canvas');
    source.width = board;
    source.height = board;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 不可用');
    const scale = Math.max(board / image.naturalWidth, board / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (board - width) / 2, (board - height) / 2, width, height);
    const data = ctx.getImageData(0, 0, board, board).data;
    const pixels: Rgb[] = [];
    for (let index = 0; index < data.length; index += 4) {
      pixels.push(applyFilters({ r: data[index], g: data[index + 1], b: data[index + 2] }, filters));
    }
    return makePattern(pixels, board, board, colorCount);
  }, [board, colorCount, filters, image]);

  useEffect(() => {
    if (!image) return;
    setProcessing(true);
    const id = window.setTimeout(() => {
      try {
        setPattern(createPattern());
        setError('');
      } catch {
        setError('生成预览失败。请刷新页面后换一张较小的图片重试。');
      } finally {
        setProcessing(false);
      }
    }, 180);
    return () => window.clearTimeout(id);
  }, [createPattern, image]);

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择 JPG、PNG、WebP 等图片文件。');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('图片请控制在 12MB 内；图纸只会在本机浏览器生成。');
      return;
    }
    let previewUrl = '';
    try {
      previewUrl = URL.createObjectURL(file);
      const uploadedImage = await readImage(previewUrl);
      setImage(uploadedImage);
      setImagePreviewUrl(previewUrl);
      setFileName(file.name);
      setPattern(null);
      setError('');
    } catch {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError('图片无法读取，请换一张图片后重试。');
    }
  };

  const choosePreset = (preset: FilterPreset) => {
    setFilters({ preset, ...presetOptions(preset) });
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern) return;
    const link = document.createElement('a');
    link.download = `${fileName.replace(/\.[^.]+$/, '') || 'perler'}-${pattern.width}x${pattern.height}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <LabFrame slug="perler" title="perler.pattern" accent="pink" desc="上传图片，量化成可照着拼的格子图；处理全程只在你的浏览器内完成。">
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="space-y-4" aria-labelledby="source-heading">
            <h2 id="source-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>load ./image</h2>
            <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void selectFile(event.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }}
              className="min-h-36 w-full cursor-pointer rounded-lg border border-dashed border-terminal-line bg-terminal-bg/40 px-5 py-7 text-center transition-colors hover:border-terminal-pink/70 hover:bg-terminal-panel/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-green"
            >
              <span className="mx-auto flex w-fit rounded border border-terminal-pink/50 p-2 text-terminal-pink"><IconUpload /></span>
              <span className="mt-3 block text-sm text-terminal-gray">{fileName || '点击或拖入一张图片'}</span>
              <span className="mt-1 block text-xs text-terminal-gray/60">JPG / PNG / WebP · 最大 12MB · 不会上传至服务器</span>
            </button>
            {imagePreviewUrl && (
              <figure className="overflow-hidden rounded border border-terminal-line bg-terminal-bg/60">
                <figcaption className="border-b border-terminal-line/60 px-3 py-2 text-xs text-terminal-cyan">
                  <span className="text-terminal-pink">$ </span>preview ./original
                </figcaption>
                <img src={imagePreviewUrl} alt={`原图预览：${fileName}`} className="block aspect-video w-full object-contain" />
              </figure>
            )}
            {error && <p className="text-sm text-terminal-pink" role="alert">{error}</p>}
          </section>

          <section className="space-y-4" aria-labelledby="settings-heading">
            <h2 id="settings-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>configure</h2>
            <label className="block text-xs text-terminal-gray" htmlFor="board-size">豆板尺寸（格）
              <select id="board-size" value={board} onChange={(event) => setBoard(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green">
                {BOARD_SIZES.map((size) => <option key={size} value={size}>{size} × {size} {size === 14 ? 'mini' : size === 29 ? 'standard' : 'large'}</option>)}
              </select>
            </label>
            <label className="block text-xs text-terminal-gray" htmlFor="color-count">颜色数量
              <select id="color-count" value={colorCount} onChange={(event) => setColorCount(Number(event.target.value) as (typeof COLOR_COUNTS)[number])} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green">
                {COLOR_COUNTS.map((count) => <option key={count} value={count}>{count} 色</option>)}
              </select>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-terminal-gray"><input checked={numbers} onChange={(event) => setNumbers(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 每格印颜色编号</label>
          </section>
        </div>

        <section className="border-t border-terminal-line/60 pt-5" aria-labelledby="filter-heading">
          <h2 id="filter-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>apply --filter</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="滤镜风格">
            {([['original', '原图'], ['vivid', '鲜明'], ['warm', '暖色'], ['cartoon', '卡通'], ['mono', '黑白']] as const).map(([preset, label]) => (
              <button key={preset} type="button" onClick={() => choosePreset(preset)} className={`min-h-10 rounded border px-3 text-xs transition-colors ${filters.preset === preset ? 'border-terminal-green bg-terminal-green/10 text-terminal-green' : 'border-terminal-line text-terminal-gray hover:border-terminal-cyan hover:text-terminal-cyan'}`}>{label}</button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {([['brightness', '亮度'], ['contrast', '对比'], ['saturation', '饱和']] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-terminal-gray" htmlFor={key}>{label} <span className="text-terminal-cyan">{filters[key]}</span>
                <input id={key} className="mt-2 w-full accent-terminal-green" type="range" min="-50" max="50" value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, preset: 'original', [key]: Number(event.target.value) }))} />
              </label>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-terminal-line/60 pt-5">
          {pattern && <button type="button" onClick={download} className="min-h-11 rounded border border-terminal-green/70 px-4 text-sm text-terminal-green transition-colors hover:bg-terminal-green/10">下载 PNG 图纸</button>}
          <span className="text-xs text-terminal-gray/60" aria-live="polite">{processing ? '正在更新预览…' : image ? '调整参数后会自动更新预览。' : '上传图片后会自动生成预览。'}</span>
          <span className="text-xs text-terminal-gray/60">图片会按中心裁切填满豆板；成图的数字对应下方色卡编号。</span>
        </div>

        {pattern && (
          <section className="grid gap-6 border-t border-terminal-line/60 pt-6 lg:grid-cols-[minmax(0,1fr)_260px]" aria-labelledby="result-heading">
            <div className="min-w-0">
              <div className="mb-3 flex items-baseline justify-between gap-3"><h2 id="result-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>print ./pattern.png</h2><span className="text-xs text-terminal-gray/60">{pattern.width} × {pattern.height} · 已用 {pattern.palette.length} 色</span></div>
              <div className="overflow-auto rounded border border-terminal-line bg-terminal-bg p-3">
                <canvas ref={canvasRef} className="mx-auto block max-w-none" aria-label={`${pattern.width} × ${pattern.height} 拼豆图纸，含颜色编号`} />
              </div>
            </div>
            <aside className="min-w-0" aria-label="颜色编号色卡">
              <h2 className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>cat ./palette</h2>
              <p className="mt-2 text-xs leading-relaxed text-terminal-gray/60">按编号取豆；数量是该颜色所需的颗数，建议多备 5%。</p>
              <ol className="mt-3 grid max-h-[580px] grid-cols-1 gap-1 overflow-y-auto pr-1 text-xs">
                {pattern.palette.map((color, index) => <li key={rgbHex(color)} className="flex min-h-9 items-center gap-2 rounded border border-terminal-line/60 bg-terminal-bg/50 px-2 text-terminal-gray"><span className="h-5 w-5 shrink-0 rounded-sm border border-terminal-line" style={{ backgroundColor: rgbCss(color) }} /><span className="w-7 text-terminal-cyan">#{index + 1}</span><span className="font-mono">{rgbHex(color)}</span><span className="ml-auto text-terminal-yellow">×{pattern.counts[index]}</span></li>)}
              </ol>
            </aside>
          </section>
        )}
      </div>
    </LabFrame>
  );
}
