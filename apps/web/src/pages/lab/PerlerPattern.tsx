import { useCallback, useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';
import {
  COLOR_COUNTS,
  applyFilters,
  makePattern,
  mapPatternToBeads,
  presetOptions,
  rgbHex,
  STARTER_PALETTES,
  type FilterOptions,
  type FilterPreset,
  type PatternResult,
  type Rgb,
} from '../../lib/perlerPattern';
import { MARD_STANDARD_PALETTE } from '../../lib/mardPalette';

const BOARD_PRESETS = [
  { width: 14, height: 14, label: '14 × 14 · mini' },
  { width: 19, height: 19, label: '19 × 19 · 小方板' },
  { width: 29, height: 29, label: '29 × 29 · 标准方板' },
  { width: 29, height: 58, label: '29 × 58 · 双板竖向' },
  { width: 58, height: 29, label: '58 × 29 · 双板横向' },
  { width: 58, height: 58, label: '58 × 58 · 四板拼接' },
] as const;
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_GRID_DIMENSION = 1000;

function toGridDimension(value: string): number {
  return Math.max(1, Math.min(MAX_GRID_DIMENSION, Number.parseInt(value, 10) || 1));
}

function rgbCss(color: Rgb): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function drawPattern(canvas: HTMLCanvasElement, pattern: PatternResult, withNumbers: boolean) {
  const cellSize = Math.max(1, Math.min(36, Math.floor(1440 / Math.max(pattern.width, pattern.height))));
  canvas.width = pattern.width * cellSize;
  canvas.height = pattern.height * cellSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0f10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const showCodes = withNumbers && cellSize >= 16;
  ctx.font = `${Math.max(8, Math.floor(cellSize * 0.35))}px monospace`;
  pattern.cells.forEach((cell, index) => {
    const x = (index % pattern.width) * cellSize;
    const y = Math.floor(index / pattern.width) * cellSize;
    ctx.fillStyle = rgbCss(cell);
    ctx.fillRect(x, y, cellSize, cellSize);
    if (cellSize >= 3) {
      ctx.strokeStyle = 'rgba(11, 15, 16, 0.45)';
      ctx.strokeRect(x, y, cellSize, cellSize);
    }
    if (showCodes) {
      const lightness = cell.r * 0.299 + cell.g * 0.587 + cell.b * 0.114;
      ctx.fillStyle = lightness > 150 ? '#0b0f10' : '#ffffff';
      ctx.fillText(pattern.palette[cell.colorId]?.code ?? String(cell.colorId + 1), x + cellSize / 2, y + cellSize / 2 + 0.5);
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
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(100);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [gridWidth, setGridWidth] = useState(29);
  const [gridHeight, setGridHeight] = useState(29);
  const [colorCount, setColorCount] = useState<(typeof COLOR_COUNTS)[number]>(48);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [filters, setFilters] = useState<FilterOptions>({ preset: 'original', ...presetOptions('original') });
  const [numbers, setNumbers] = useState(true);
  const [pattern, setPattern] = useState<PatternResult | null>(null);
  const [history, setHistory] = useState<PatternResult[]>([]);
  const [future, setFuture] = useState<PatternResult[]>([]);
  const [selectedColor, setSelectedColor] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [paletteName, setPaletteName] = useState('Mard 标准 221 色');
  const [customPalette, setCustomPalette] = useState<typeof STARTER_PALETTES['通用基础']>([]);
  const [stockOnly, setStockOnly] = useState(false);
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
    source.width = gridWidth;
    source.height = gridHeight;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 不可用');
    if (fitMode === 'contain') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, gridWidth, gridHeight);
    }
    const scale = (fitMode === 'cover' ? Math.max : Math.min)(gridWidth / image.naturalWidth, gridHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (gridWidth - width) / 2, (gridHeight - height) / 2, width, height);
    const data = ctx.getImageData(0, 0, gridWidth, gridHeight).data;
    const pixels: Rgb[] = [];
    for (let index = 0; index < data.length; index += 4) {
      pixels.push(applyFilters({ r: data[index], g: data[index + 1], b: data[index + 2] }, filters));
    }
    const draft = makePattern(pixels, gridWidth, gridHeight, colorCount);
    if (paletteName === '智能量化' && !customPalette.length) return draft;
    const sourcePalette = customPalette.length ? customPalette : paletteName === 'Mard 标准 221 色' ? MARD_STANDARD_PALETTE : STARTER_PALETTES[paletteName];
    const available = sourcePalette.filter((color) => !stockOnly || color.inStock !== false);
    return mapPatternToBeads(draft, available);
  }, [colorCount, customPalette, filters, fitMode, gridHeight, gridWidth, image, paletteName, stockOnly]);

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

  const editCell = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pattern || !canvasRef.current || selectedColor >= pattern.palette.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * pattern.width);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * pattern.height);
    const index = row * pattern.width + column;
    if (index < 0 || index >= pattern.cells.length || pattern.cells[index].colorId === selectedColor) return;
    const next = structuredClone(pattern);
    next.cells[index] = { ...next.palette[selectedColor], colorId: selectedColor };
    next.counts = next.palette.map((_, colorId) => next.cells.filter((cell) => cell.colorId === colorId).length);
    setHistory((items) => [...items.slice(-49), pattern]);
    setFuture([]);
    setPattern(next);
  };

  const pinchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (!first || !second) return;
    pinchDistanceRef.current = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    pinchZoomRef.current = zoom;
  };

  const pinchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchDistanceRef.current) return;
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (!first || !second) return;
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    setZoom(Math.max(60, Math.min(240, Math.round(pinchZoomRef.current * distance / pinchDistanceRef.current))));
  };

  const exportCsv = () => {
    if (!pattern) return;
    const rows = ['编号,色号,色名,品牌,色值,颗数,建议备量'];
    pattern.palette.forEach((color, index) => rows.push(`${index + 1},${color.code},${color.name},${color.brand},${rgbHex(color)},${pattern.counts[index]},${Math.ceil(pattern.counts[index] * 1.05)}`));
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '') || 'perler'}-shopping-list.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const printPdf = () => {
    if (!canvasRef.current) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) return;
    popup.document.write(`<img alt="拼豆图纸" style="max-width:100%" src="${canvasRef.current.toDataURL('image/png')}" onload="print()">`);
    popup.document.close();
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
            <label className="block text-xs text-terminal-gray" htmlFor="board-size">常用豆板尺寸（格）
              <select id="board-size" value={`${gridWidth}x${gridHeight}`} onChange={(event) => { const [width, height] = event.target.value.split('x').map(Number); setGridWidth(width); setGridHeight(height); }} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green">
                {BOARD_PRESETS.map(({ width, height, label }) => <option key={`${width}x${height}`} value={`${width}x${height}`}>{label}</option>)}
                {!BOARD_PRESETS.some(({ width, height }) => width === gridWidth && height === gridHeight) && <option value={`${gridWidth}x${gridHeight}`}>自定义 · {gridWidth} × {gridHeight}</option>}
              </select>
            </label>
            <fieldset className="grid grid-cols-2 gap-2 text-xs text-terminal-gray">
              <legend className="mb-1.5">自定义尺寸（1–{MAX_GRID_DIMENSION} 格）</legend>
              <label htmlFor="grid-width">列数
                <input id="grid-width" type="number" min="1" max={MAX_GRID_DIMENSION} value={gridWidth} onChange={(event) => setGridWidth(toGridDimension(event.target.value))} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green" />
              </label>
              <label htmlFor="grid-height">行数
                <input id="grid-height" type="number" min="1" max={MAX_GRID_DIMENSION} value={gridHeight} onChange={(event) => setGridHeight(toGridDimension(event.target.value))} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green" />
              </label>
            </fieldset>
            <label className="block text-xs text-terminal-gray" htmlFor="color-count">颜色数量
              <select id="color-count" value={colorCount} onChange={(event) => setColorCount(Number(event.target.value) as (typeof COLOR_COUNTS)[number])} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green">
                {COLOR_COUNTS.map((count) => <option key={count} value={count}>{count} 色</option>)}
              </select>
            </label>
            <label className="block text-xs text-terminal-gray" htmlFor="palette-name">色板
              <select id="palette-name" value={paletteName} onChange={(event) => { setPaletteName(event.target.value); setCustomPalette([]); }} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray">
                <option value="Mard 标准 221 色">Mard 标准 221 色（真实色号）</option>
                <option value="智能量化">智能量化（仅预览，不可采购）</option>
                {Object.keys(STARTER_PALETTES).map((name) => <option key={name}>{name}</option>)}
                {customPalette.length > 0 && <option value="自定义">自定义导入</option>}
              </select>
            </label>
            <label className="block text-xs text-terminal-gray" htmlFor="fit-mode">构图
              <select id="fit-mode" value={fitMode} onChange={(event) => setFitMode(event.target.value as 'cover' | 'contain')} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray">
                <option value="cover">铺满豆板（中心裁切）</option>
                <option value="contain">完整保留（可能留边）</option>
              </select>
            </label>
            <label className="block text-xs text-terminal-gray">导入色板 JSON
              <input type="file" accept="application/json" className="mt-1.5 block w-full text-xs text-terminal-gray" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((text) => { const parsed = JSON.parse(text) as Array<{ code: string; name?: string; hex: string; inStock?: boolean }>; setCustomPalette(parsed.map((item) => ({ code: item.code, name: item.name ?? item.code, brand: '自定义', inStock: item.inStock, r: Number.parseInt(item.hex.slice(1, 3), 16), g: Number.parseInt(item.hex.slice(3, 5), 16), b: Number.parseInt(item.hex.slice(5, 7), 16) }))); setPaletteName('自定义'); }).catch(() => setError('色板 JSON 格式无效。')); }} />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-terminal-gray"><input checked={numbers} onChange={(event) => setNumbers(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 每格印颜色编号</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-terminal-gray"><input checked={stockOnly} onChange={(event) => setStockOnly(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 仅使用库存色（导入色板可扩展库存字段）</label>
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
          {pattern && <button type="button" onClick={exportCsv} className="min-h-11 rounded border border-terminal-cyan/70 px-4 text-sm text-terminal-cyan transition-colors hover:bg-terminal-cyan/10">导出 CSV 清单</button>}
          {pattern && <button type="button" onClick={printPdf} className="min-h-11 rounded border border-terminal-yellow/70 px-4 text-sm text-terminal-yellow transition-colors hover:bg-terminal-yellow/10">打印 / 存为 PDF</button>}
          <span className="text-xs text-terminal-gray/60" aria-live="polite">{processing ? '正在更新预览…' : image ? '调整参数后会自动更新预览。' : '上传图片后会自动生成预览。'}</span>
          <span className="text-xs text-terminal-gray/60">成图数字对应下方色卡编号；可切换构图以保留完整照片。</span>
        </div>

        {pattern && (
          <section className="grid gap-6 border-t border-terminal-line/60 pt-6 lg:grid-cols-[minmax(0,1fr)_260px]" aria-labelledby="result-heading">
            <div className="min-w-0">
              <div className="mb-3 flex items-baseline justify-between gap-3"><h2 id="result-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>print ./pattern.png</h2><span className="text-xs text-terminal-gray/60">{pattern.width} × {pattern.height} · 已用 {pattern.palette.length} 色</span></div>
              <div onTouchStart={pinchStart} onTouchMove={pinchMove} onTouchEnd={() => { pinchDistanceRef.current = null; }} className="overflow-auto rounded border border-terminal-line bg-terminal-bg p-3 touch-none">
                <canvas ref={canvasRef} onDoubleClick={() => setZoom((current) => current === 100 ? 180 : 100)} onPointerDown={editCell} className="mx-auto block max-w-none cursor-crosshair" style={{ width: `${zoom}%` }} aria-label={`${pattern.width} × ${pattern.height} 拼豆图纸。双击或双指缩放，点击格子改色`} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-terminal-gray">
                <button type="button" disabled={!history.length} onClick={() => { const previous = history.at(-1); if (!previous || !pattern) return; setHistory((items) => items.slice(0, -1)); setFuture((items) => [pattern, ...items]); setPattern(previous); }} className="min-h-9 rounded border border-terminal-line px-2 disabled:opacity-40">撤销</button>
                <button type="button" disabled={!future.length} onClick={() => { const next = future[0]; if (!next || !pattern) return; setFuture((items) => items.slice(1)); setHistory((items) => [...items, pattern]); setPattern(next); }} className="min-h-9 rounded border border-terminal-line px-2 disabled:opacity-40">重做</button>
                <label>缩放 <input type="range" min="60" max="240" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="accent-terminal-green" /></label>
                <span className="text-terminal-gray/60">双击放大 / 还原；触屏可双指缩放</span>
              </div>
            </div>
            <aside className="min-w-0" aria-label="颜色编号色卡">
              <h2 className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>cat ./palette</h2>
              <p className="mt-2 text-xs leading-relaxed text-terminal-gray/60">按编号取豆；数量是该颜色所需的颗数，建议多备 5%。智能量化色用于预览，导入品牌色板后可按真实色号采购。</p>
              <ol className="mt-3 grid max-h-[580px] grid-cols-1 gap-1 overflow-y-auto pr-1 text-xs">
                {pattern.palette.map((color, index) => <li key={color.code}><button type="button" onClick={() => setSelectedColor(index)} className={`flex min-h-11 w-full items-center gap-2 rounded border px-2 text-left text-terminal-gray ${selectedColor === index ? 'border-terminal-green bg-terminal-green/10' : 'border-terminal-line/60 bg-terminal-bg/50'}`}><span className="h-5 w-5 shrink-0 rounded-sm border border-terminal-line" style={{ backgroundColor: rgbCss(color) }} /><span className="w-7 text-terminal-cyan">#{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate font-mono">{color.code} · {color.name}</span><span className="block truncate text-terminal-gray/55">{rgbHex(color)}</span></span><span className="ml-auto text-terminal-yellow">×{pattern.counts[index]}</span></button></li>)}
              </ol>
            </aside>
          </section>
        )}
      </div>
    </LabFrame>
  );
}
