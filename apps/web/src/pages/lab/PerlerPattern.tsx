import { useCallback, useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';
import {
  COLOR_COUNTS,
  applyFilters,
  assessPatternQuality,
  cartoonizePixels,
  floodFill,
  getBoardAssembly,
  makePattern,
  mapPatternToBeads,
  presetOptions,
  recolorCell,
  suggestAlternatives,
  simplifyBackgroundPixels,
  enhanceEdgesPixels,
  rgbHex,
  STARTER_PALETTES,
  type FilterOptions,
  type FilterPreset,
  type PatternResult,
  type Rgb,
} from '../../lib/perlerPattern';
import { MARD_STANDARD_PALETTE } from '../../lib/mardPalette';
import { deletePerlerProject, listPerlerProjects, savePerlerProject, type SavedPerlerProject } from '../../lib/perlerProject';

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
  const cellSize = Math.max(1, Math.min(36, Math.floor(2048 / Math.max(pattern.width, pattern.height))));
  canvas.width = pattern.width * cellSize;
  canvas.height = pattern.height * cellSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0f10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const showCodes = withNumbers && cellSize >= 12;
  ctx.font = `${Math.max(7, Math.floor(cellSize * 0.42))}px monospace`;
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片编码失败'));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function tilePatternDataUrl(pattern: PatternResult, withNumbers: boolean, startColumn: number, startRow: number, tileSize: number): string {
  const columns = Math.min(tileSize, pattern.width - startColumn);
  const rows = Math.min(tileSize, pattern.height - startRow);
  const cellSize = 26;
  const gutter = 46;
  const canvas = document.createElement('canvas');
  canvas.width = gutter + columns * cellSize + 18;
  canvas.height = gutter + rows * cellSize + 18;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px monospace';
  for (let column = 0; column < columns; column += 1) {
    ctx.fillStyle = '#182125';
    ctx.fillText(String(startColumn + column + 1), gutter + column * cellSize + cellSize / 2, 22);
  }
  for (let row = 0; row < rows; row += 1) {
    ctx.fillStyle = '#182125';
    ctx.fillText(String(startRow + row + 1), 22, gutter + row * cellSize + cellSize / 2);
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = pattern.cells[(startRow + row) * pattern.width + startColumn + column];
      const x = gutter + column * cellSize;
      const y = gutter + row * cellSize;
      ctx.fillStyle = rgbCss(cell);
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = '#4a555b';
      ctx.strokeRect(x, y, cellSize, cellSize);
      if (withNumbers) {
        const lightness = cell.r * 0.299 + cell.g * 0.587 + cell.b * 0.114;
        ctx.fillStyle = lightness > 150 ? '#0b0f10' : '#ffffff';
        ctx.font = '8px monospace';
        ctx.fillText(pattern.palette[cell.colorId]?.code ?? String(cell.colorId + 1), x + cellSize / 2, y + cellSize / 2);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function makePatternAsync(pixels: Rgb[], width: number, height: number, colorCount: number): Promise<PatternResult> {
  if (pixels.length < 120_000) return Promise.resolve(makePattern(pixels, width, height, colorCount));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/perlerWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<PatternResult>) => { worker.terminate(); resolve(event.data); };
    worker.onerror = () => { worker.terminate(); reject(new Error('大图计算任务失败')); };
    worker.postMessage({ pixels, width, height, colorCount });
  });
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
  const cropDragRef = useRef<{ x: number; y: number; cropX: number; cropY: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [gridWidth, setGridWidth] = useState(29);
  const [gridHeight, setGridHeight] = useState(29);
  const [colorCount, setColorCount] = useState<(typeof COLOR_COUNTS)[number]>(48);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropZoom, setCropZoom] = useState(100);
  const [filters, setFilters] = useState<FilterOptions>({ preset: 'original', ...presetOptions('original') });
  const [cartoonize, setCartoonize] = useState(false);
  const [cartoonStrength, setCartoonStrength] = useState(65);
  const [backgroundSimplify, setBackgroundSimplify] = useState(false);
  const [backgroundThreshold, setBackgroundThreshold] = useState(58);
  const [edgeOutline, setEdgeOutline] = useState(false);
  const [processedPreviewUrl, setProcessedPreviewUrl] = useState('');
  const [numbers, setNumbers] = useState(true);
  const [pattern, setPattern] = useState<PatternResult | null>(null);
  const [history, setHistory] = useState<PatternResult[]>([]);
  const [future, setFuture] = useState<PatternResult[]>([]);
  const [editMode, setEditMode] = useState<'brush' | 'eyedropper' | 'fill'>('brush');
  const [printTileSize, setPrintTileSize] = useState(29);
  const [selectedColor, setSelectedColor] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [paletteName, setPaletteName] = useState('Mard 标准 221 色');
  const [customPalette, setCustomPalette] = useState<typeof STARTER_PALETTES['通用基础']>([]);
  const [stockOnly, setStockOnly] = useState(false);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [projectStatus, setProjectStatus] = useState('');
  const [projectName, setProjectName] = useState('未命名图纸');
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [savedProjects, setSavedProjects] = useState<SavedPerlerProject[]>([]);
  const [assembledTiles, setAssembledTiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (canvasRef.current && pattern) drawPattern(canvasRef.current, pattern, numbers);
  }, [numbers, pattern]);

  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!processedPreviewUrl) return;
    return () => URL.revokeObjectURL(processedPreviewUrl);
  }, [processedPreviewUrl]);

  const processedPixels = useCallback((width: number, height: number): Rgb[] | null => {
    if (!image) return null;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 不可用');
    if (fitMode === 'contain') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    const scale = (fitMode === 'cover' ? Math.max : Math.min)(width / image.naturalWidth, height / image.naturalHeight) * cropZoom / 100;
    const scaledWidth = image.naturalWidth * scale;
    const scaledHeight = image.naturalHeight * scale;
    const offsetX = (source.width - scaledWidth) / 2 + cropX / 100 * source.width * 0.5;
    const offsetY = (source.height - scaledHeight) / 2 + cropY / 100 * source.height * 0.5;
    ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
    const data = ctx.getImageData(0, 0, source.width, source.height).data;
    const pixels: Rgb[] = [];
    for (let index = 0; index < data.length; index += 4) {
      pixels.push(applyFilters({ r: data[index], g: data[index + 1], b: data[index + 2] }, filters));
    }
    const simplified = backgroundSimplify ? simplifyBackgroundPixels(pixels, source.width, source.height, backgroundThreshold) : pixels;
    const outlined = edgeOutline ? enhanceEdgesPixels(simplified, source.width, source.height, 55) : simplified;
    return cartoonize ? cartoonizePixels(outlined, source.width, source.height, cartoonStrength) : outlined;
  }, [backgroundSimplify, backgroundThreshold, cartoonStrength, cartoonize, cropX, cropY, cropZoom, edgeOutline, filters, fitMode, image]);

  const createPattern = useCallback(async () => {
    const pixels = processedPixels(gridWidth, gridHeight);
    if (!pixels) return null;
    const draft = await makePatternAsync(pixels, gridWidth, gridHeight, colorCount);
    if (paletteName === '智能量化' && !customPalette.length) return draft;
    const sourcePalette = customPalette.length ? customPalette : paletteName === 'Mard 标准 221 色' ? MARD_STANDARD_PALETTE : STARTER_PALETTES[paletteName];
    const available = sourcePalette.filter((color) => !stockOnly || color.inStock !== false);
    return mapPatternToBeads(draft, available);
  }, [colorCount, customPalette, gridHeight, gridWidth, paletteName, processedPixels, stockOnly]);

  useEffect(() => {
    if (!image) return;
    setProcessing(true);
    let cancelled = false;
    const id = window.setTimeout(() => { void (async () => {
      try {
        const nextPattern = await createPattern();
        if (cancelled) return;
        setPattern(nextPattern);
        const previewMax = 640;
        const previewWidth = gridWidth >= gridHeight ? previewMax : Math.max(1, Math.round(previewMax * gridWidth / gridHeight));
        const previewHeight = gridHeight > gridWidth ? previewMax : Math.max(1, Math.round(previewMax * gridHeight / gridWidth));
        const pixels = processedPixels(previewWidth, previewHeight);
        if (pixels) {
          const canvas = document.createElement('canvas');
          canvas.width = previewWidth;
          canvas.height = previewHeight;
          const previewContext = canvas.getContext('2d');
          if (previewContext) {
            const data = new ImageData(previewWidth, previewHeight);
            pixels.forEach((pixel, index) => {
              data.data[index * 4] = pixel.r;
              data.data[index * 4 + 1] = pixel.g;
              data.data[index * 4 + 2] = pixel.b;
              data.data[index * 4 + 3] = 255;
            });
            previewContext.putImageData(data, 0, 0);
            canvas.toBlob((blob) => { if (blob) setProcessedPreviewUrl(URL.createObjectURL(blob)); }, 'image/png');
          }
        }
        setError('');
      } catch {
        setError('生成预览失败。请刷新页面后换一张较小的图片重试。');
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })(); }, 180);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [createPattern, gridHeight, gridWidth, image, processedPixels]);

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
      setImageDataUrl(await readFileAsDataUrl(file));
      setProcessedPreviewUrl('');
      setFileName(file.name);
      setPattern(null);
      setCropX(0);
      setCropY(0);
      setCropZoom(100);
      setError('');
    } catch {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError('图片无法读取，请换一张图片后重试。');
    }
  };

  const choosePreset = (preset: FilterPreset) => {
    setFilters({ preset, ...presetOptions(preset) });
    if (preset === 'cartoon') setCartoonize(true);
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
    if (index < 0 || index >= pattern.cells.length) return;
    if (editMode === 'eyedropper') {
      setSelectedColor(pattern.cells[index].colorId);
      return;
    }
    const next = editMode === 'fill' ? floodFill(pattern, index, selectedColor) : recolorCell(pattern, index, selectedColor);
    if (next === pattern) return;
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

  const downloadPaletteTemplate = () => {
    const template = [{ code: '品牌色号', name: '颜色名', hex: '#RRGGBB', inStock: true }];
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'perler-palette-template.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const printPdf = () => {
    if (!pattern) return;
    const popup = window.open('', '_blank');
    if (!popup) return;
    const pages: string[] = [];
    for (let row = 0; row < pattern.height; row += printTileSize) {
      for (let column = 0; column < pattern.width; column += printTileSize) {
        const image = tilePatternDataUrl(pattern, numbers, column, row, printTileSize);
        pages.push(`<section><h1>${fileName || '拼豆图纸'} · 列 ${column + 1}–${Math.min(pattern.width, column + printTileSize)} / 行 ${row + 1}–${Math.min(pattern.height, row + printTileSize)}</h1><img alt="拼豆分页图纸" src="${image}"><p>色号以色卡中的 Mard 编码为准。</p></section>`);
      }
    }
    popup.document.write(`<style>body{font-family:monospace;color:#111}section{break-after:page;text-align:center}img{max-width:100%;max-height:88vh}h1{font-size:14px}p{font-size:11px}</style>${pages.join('')}<script>onload=()=>print()<\/script>`);
    popup.document.close();
  };

  const refreshProjects = async () => setSavedProjects(await listPerlerProjects());

  useEffect(() => { void refreshProjects().catch(() => undefined); }, []);

  const saveProject = async () => {
    if (!imageDataUrl) return;
    try {
      const saved = await savePerlerProject({ id: currentProjectId || undefined, projectName: projectName.trim() || '未命名图纸', fileName, imageDataUrl, gridWidth, gridHeight, colorCount, fitMode, cropX, cropY, cropZoom, filters, cartoonize, cartoonStrength, backgroundSimplify, backgroundThreshold, edgeOutline, paletteName, customPalette, stockOnly, numbers });
      setCurrentProjectId(saved.id);
      setProjectName(saved.projectName);
      await refreshProjects();
      setProjectStatus('项目已保存在此浏览器，可随时继续。');
    } catch {
      setProjectStatus('项目保存失败：浏览器存储不可用或空间不足。');
    }
  };

  const restoreProject = async (project: SavedPerlerProject) => {
    try {
      const restoredImage = await readImage(project.imageDataUrl);
      setImage(restoredImage);
      setImagePreviewUrl(project.imageDataUrl);
      setImageDataUrl(project.imageDataUrl);
      setFileName(project.fileName);
      setGridWidth(project.gridWidth); setGridHeight(project.gridHeight); setColorCount(project.colorCount as (typeof COLOR_COUNTS)[number]);
      setFitMode(project.fitMode); setCropX(project.cropX); setCropY(project.cropY); setCropZoom(project.cropZoom);
      setFilters(project.filters); setCartoonize(project.cartoonize); setCartoonStrength(project.cartoonStrength); setBackgroundSimplify(project.backgroundSimplify ?? false); setBackgroundThreshold(project.backgroundThreshold ?? 58); setEdgeOutline(project.edgeOutline ?? false);
      setPaletteName(project.paletteName); setCustomPalette(project.customPalette); setStockOnly(project.stockOnly); setNumbers(project.numbers);
      setProjectName(project.projectName || '未命名图纸'); setCurrentProjectId(project.id);
      setProjectStatus(`已恢复 ${new Date(project.savedAt).toLocaleString()} 保存的项目。`);
    } catch {
      setProjectStatus('项目恢复失败：保存内容已损坏或浏览器不支持。');
    }
  };

  const downloadProjectBackup = () => {
    const current = savedProjects.find((item) => item.id === currentProjectId);
    if (!current) {
      setProjectStatus('请先保存当前项目，再导出备份。');
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(current)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${current.projectName || 'perler'}-backup.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importProjectBackup = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(async (text) => {
      const parsed = JSON.parse(text) as SavedPerlerProject;
      if (!parsed.imageDataUrl || !parsed.gridWidth || !parsed.gridHeight) throw new Error('备份内容不完整');
      const saved = await savePerlerProject({ ...parsed, id: undefined, projectName: `${parsed.projectName || '未命名图纸'}（导入）` });
      await refreshProjects();
      await restoreProject(saved);
    }).catch(() => setProjectStatus('项目备份格式无效。'));
  };

  const removeProject = async (id: string) => {
    await deletePerlerProject(id);
    if (id === currentProjectId) setCurrentProjectId('');
    await refreshProjects();
  };

  const startCropDrag = (event: React.PointerEvent<HTMLImageElement>) => {
    if (fitMode !== 'cover') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = { x: event.clientX, y: event.clientY, cropX, cropY };
  };

  const moveCropDrag = (event: React.PointerEvent<HTMLImageElement>) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCropX(Math.max(-100, Math.min(100, drag.cropX + (event.clientX - drag.x) / rect.width * 180)));
    setCropY(Math.max(-100, Math.min(100, drag.cropY + (event.clientY - drag.y) / rect.height * 180)));
  };

  return (
    <LabFrame slug="perler" title="perler.pattern" accent="pink" desc="上传图片，量化成可照着拼的格子图；处理全程只在你的浏览器内完成。">
      <div className="p-4 sm:p-6 space-y-6">
        <ol className="grid gap-2 border-b border-terminal-line/60 pb-5 text-xs sm:grid-cols-4" aria-label="制作步骤">
          {[
            ['01', '导入图片', Boolean(image)],
            ['02', '设置图纸', Boolean(image)],
            ['03', '核对色号', Boolean(pattern)],
            ['04', '导出制作', Boolean(pattern)],
          ].map(([step, label, done]) => <li key={String(step)} className={`flex min-h-11 items-center gap-2 rounded border px-3 ${done ? 'border-terminal-green/60 bg-terminal-green/10 text-terminal-green' : 'border-terminal-line/60 bg-terminal-bg/40 text-terminal-gray/65'}`}><span className="text-terminal-pink">{step}</span><span>{label}</span>{done && <span className="ml-auto text-terminal-cyan">ready</span>}</li>)}
        </ol>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <figure className="overflow-hidden rounded border border-terminal-line bg-terminal-bg/60">
                  <figcaption className="border-b border-terminal-line/60 px-3 py-2 text-xs text-terminal-cyan"><span className="text-terminal-pink">$ </span>preview ./original</figcaption>
                  <img src={imagePreviewUrl} alt={`原图预览：${fileName}`} className="block aspect-video w-full object-contain" />
                </figure>
                <figure className="overflow-hidden rounded border border-terminal-green/50 bg-terminal-bg/60">
                  <figcaption className="border-b border-terminal-line/60 px-3 py-2 text-xs text-terminal-green"><span className="text-terminal-pink">$ </span>preview ./processed</figcaption>
                  {processedPreviewUrl ? <img src={processedPreviewUrl} alt={`处理后预览：${fileName}；铺满模式下可拖动定位主体`} onPointerDown={startCropDrag} onPointerMove={moveCropDrag} onPointerUp={() => { cropDragRef.current = null; }} className={`block aspect-video w-full object-contain ${fitMode === 'cover' ? 'cursor-move touch-none' : ''}`} /> : <div className="flex aspect-video items-center justify-center text-xs text-terminal-gray/60">正在生成处理预览…</div>}
                </figure>
              </div>
            )}
            {error && <p className="text-sm text-terminal-pink" role="alert">{error}</p>}
          </section>

          <section className="space-y-4 self-start rounded border border-terminal-line bg-terminal-panel/30 p-4 lg:sticky lg:top-5" aria-labelledby="settings-heading">
            <div><h2 id="settings-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>configure ./pattern</h2><p className="mt-1 text-xs leading-relaxed text-terminal-gray/60">从豆板、实体色号到构图依次设置；每次调整会自动刷新下方图纸。</p></div>
            <fieldset className="rounded border border-terminal-line/70 p-3 text-xs text-terminal-gray">
              <legend className="px-1 text-terminal-cyan">照片处理</legend>
              <p className="leading-relaxed text-terminal-gray/60">照片纹理多时，先转卡通可减少碎色，让成图更清晰。</p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="照片处理方式">
                <button type="button" onClick={() => setCartoonize(false)} className={`min-h-11 rounded border px-2 text-xs transition-colors ${!cartoonize ? 'border-terminal-green bg-terminal-green/10 text-terminal-green' : 'border-terminal-line hover:border-terminal-cyan'}`}>保留照片</button>
                <button type="button" onClick={() => setCartoonize(true)} className={`min-h-11 rounded border px-2 text-xs transition-colors ${cartoonize ? 'border-terminal-green bg-terminal-green/10 text-terminal-green' : 'border-terminal-line hover:border-terminal-cyan'}`}>转卡通</button>
              </div>
              {cartoonize && <label className="mt-3 block" htmlFor="cartoon-strength">卡通强度 <span className="text-terminal-cyan">{cartoonStrength}</span><input id="cartoon-strength" className="mt-2 w-full accent-terminal-green" type="range" min="20" max="100" value={cartoonStrength} onChange={(event) => setCartoonStrength(Number(event.target.value))} /></label>}
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2"><input checked={backgroundSimplify} onChange={(event) => setBackgroundSimplify(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 简化纯色背景为白色</label>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2"><input checked={edgeOutline} onChange={(event) => setEdgeOutline(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 强调主体轮廓</label>
              {backgroundSimplify && <label className="mt-2 block" htmlFor="background-threshold">背景相似度 <span className="text-terminal-cyan">{backgroundThreshold}</span><input id="background-threshold" className="mt-2 w-full accent-terminal-green" type="range" min="20" max="120" value={backgroundThreshold} onChange={(event) => setBackgroundThreshold(Number(event.target.value))} /><span className="mt-1 block text-terminal-gray/60">只处理与四角相连的近似色背景，复杂背景请保留原图。</span></label>}
            </fieldset>
            <fieldset className="rounded border border-terminal-line/70 p-3 text-xs text-terminal-gray">
              <legend className="px-1 text-terminal-cyan">裁切与项目</legend>
              <p className="leading-relaxed text-terminal-gray/60">铺满模式下可直接拖动右侧处理预览移动主体；下方调整精度更高。</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label htmlFor="crop-x">横移 <span className="text-terminal-cyan">{Math.round(cropX)}</span><input id="crop-x" className="mt-1 w-full accent-terminal-green" type="range" min="-100" max="100" value={cropX} onChange={(event) => setCropX(Number(event.target.value))} /></label>
                <label htmlFor="crop-y">纵移 <span className="text-terminal-cyan">{Math.round(cropY)}</span><input id="crop-y" className="mt-1 w-full accent-terminal-green" type="range" min="-100" max="100" value={cropY} onChange={(event) => setCropY(Number(event.target.value))} /></label>
                <label htmlFor="crop-zoom">缩放 <span className="text-terminal-cyan">{cropZoom}%</span><input id="crop-zoom" className="mt-1 w-full accent-terminal-green" type="range" min="100" max="220" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} /></label>
              </div>
              <label className="mt-3 block" htmlFor="project-name">项目名称<input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-terminal-gray" /></label>
              <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!imageDataUrl} onClick={() => void saveProject()} className="min-h-11 rounded border border-terminal-cyan/70 px-2 text-terminal-cyan disabled:opacity-40">保存到项目库</button><button type="button" onClick={downloadProjectBackup} className="min-h-11 rounded border border-terminal-line px-2 hover:border-terminal-green">导出项目备份</button></div>
              <label className="mt-2 block cursor-pointer rounded border border-terminal-line px-2 py-2 text-terminal-cyan">导入项目备份<input type="file" accept="application/json" className="sr-only" onChange={(event) => importProjectBackup(event.target.files?.[0])} /></label>
              {savedProjects.length > 0 && <ol className="mt-3 max-h-40 space-y-1 overflow-y-auto">{savedProjects.map((project) => <li key={project.id} className="flex items-center gap-2 rounded border border-terminal-line/60 bg-terminal-bg/50 px-2 py-1.5"><button type="button" onClick={() => void restoreProject(project)} className="min-h-9 min-w-0 flex-1 truncate text-left hover:text-terminal-green">{project.projectName || '未命名图纸'}</button><span className="text-terminal-gray/50">{project.gridWidth}×{project.gridHeight}</span><button type="button" onClick={() => void removeProject(project.id)} className="min-h-9 px-1 text-terminal-pink" aria-label={`删除 ${project.projectName}`}>×</button></li>)}</ol>}
              {projectStatus && <p className="mt-2 text-terminal-gray/60" aria-live="polite">{projectStatus}</p>}
            </fieldset>
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <label className="block text-xs text-terminal-gray" htmlFor="palette-name">实体色板
                <select id="palette-name" value={paletteName} onChange={(event) => { setPaletteName(event.target.value); setCustomPalette([]); }} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray">
                  <option value="Mard 标准 221 色">Mard 标准 221 色</option>
                  <option value="智能量化">智能量化（预览）</option>
                  {Object.keys(STARTER_PALETTES).map((name) => <option key={name}>{name}</option>)}
                  {customPalette.length > 0 && <option value="自定义">自定义导入</option>}
                </select>
              </label>
              <label className="block text-xs text-terminal-gray" htmlFor="color-count">最终用色上限
                <select id="color-count" value={colorCount} onChange={(event) => setColorCount(Number(event.target.value) as (typeof COLOR_COUNTS)[number])} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray outline-none focus:border-terminal-green">
                  {COLOR_COUNTS.map((count) => <option key={count} value={count}>{count} 色</option>)}
                </select>
              </label>
            </div>
            <label className="block text-xs text-terminal-gray" htmlFor="fit-mode">构图
              <select id="fit-mode" value={fitMode} onChange={(event) => setFitMode(event.target.value as 'cover' | 'contain')} className="mt-1.5 h-10 w-full rounded border border-terminal-line bg-terminal-bg px-2 text-sm text-terminal-gray">
                <option value="cover">铺满豆板（中心裁切）</option>
                <option value="contain">完整保留（可能留边）</option>
              </select>
            </label>
            <label className="block text-xs text-terminal-gray">扩展品牌色板 JSON
              <input type="file" accept="application/json" className="mt-1.5 block w-full text-xs text-terminal-gray" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((text) => { const parsed = JSON.parse(text) as Array<{ code: string; name?: string; hex: string; inStock?: boolean }>; setCustomPalette(parsed.map((item) => ({ code: item.code, name: item.name ?? item.code, brand: '自定义', inStock: item.inStock, r: Number.parseInt(item.hex.slice(1, 3), 16), g: Number.parseInt(item.hex.slice(3, 5), 16), b: Number.parseInt(item.hex.slice(5, 7), 16) }))); setPaletteName('自定义'); }).catch(() => setError('色板 JSON 格式无效。')); }} />
            </label>
            <button type="button" onClick={downloadPaletteTemplate} className="min-h-9 w-full rounded border border-terminal-line px-2 text-left text-xs text-terminal-cyan hover:border-terminal-cyan">下载品牌色板 JSON 模板（色板会随项目一起保存）</button>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-terminal-gray"><input checked={numbers} onChange={(event) => setNumbers(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 每格印颜色编号</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-terminal-gray"><input checked={stockOnly} onChange={(event) => setStockOnly(event.target.checked)} type="checkbox" className="accent-terminal-green" /> 仅使用库存色（导入色板可扩展库存字段）</label>
          </section>
        </div>

        <section className="border-t border-terminal-line/60 pt-5" aria-labelledby="filter-heading">
          <h2 id="filter-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>apply --filter</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="滤镜风格">
            {([['original', '原图'], ['vivid', '鲜明'], ['warm', '暖色'], ['cartoon', '卡通色调'], ['mono', '黑白']] as const).map(([preset, label]) => (
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

        <p className="border-t border-terminal-line/60 pt-5 text-xs text-terminal-gray/60" aria-live="polite">{processing ? gridWidth * gridHeight >= 120_000 ? '正在后台量化大图，页面仍可继续操作…' : '正在更新原图处理与图纸预览…' : image ? `已生成${cartoonize ? '卡通' : '照片'}预览：核对图纸与 Mard 色号后再导出。` : '上传图片后会自动生成预览。'}</p>

        {pattern && (
          <section className="grid gap-6 border-t border-terminal-line/60 pt-6 lg:grid-cols-[minmax(0,1fr)_260px]" aria-labelledby="result-heading">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="result-heading" className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>review ./pattern.png</h2><span className="text-xs text-terminal-gray/60">{pattern.width} × {pattern.height} · 已用 {pattern.palette.length} 色</span></div>
              <div onTouchStart={pinchStart} onTouchMove={pinchMove} onTouchEnd={() => { pinchDistanceRef.current = null; }} className="overflow-auto rounded border border-terminal-line bg-terminal-bg p-3 touch-none">
                <canvas ref={canvasRef} onDoubleClick={() => setZoom((current) => current === 100 ? 180 : 100)} onPointerDown={editCell} className="mx-auto block max-w-none cursor-crosshair" style={{ width: `${zoom}%` }} aria-label={`${pattern.width} × ${pattern.height} 拼豆图纸。双击或双指缩放，点击格子改色`} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-terminal-gray">
                <button type="button" disabled={!history.length} onClick={() => { const previous = history.at(-1); if (!previous || !pattern) return; setHistory((items) => items.slice(0, -1)); setFuture((items) => [pattern, ...items]); setPattern(previous); }} className="min-h-9 rounded border border-terminal-line px-2 disabled:opacity-40">撤销</button>
                <button type="button" disabled={!future.length} onClick={() => { const next = future[0]; if (!next || !pattern) return; setFuture((items) => items.slice(1)); setHistory((items) => [...items, pattern]); setPattern(next); }} className="min-h-9 rounded border border-terminal-line px-2 disabled:opacity-40">重做</button>
                <label>缩放 <input type="range" min="60" max="240" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="accent-terminal-green" /></label>
                <span className="text-terminal-gray/60">双击放大 / 还原；触屏可双指缩放</span>
              </div>
              <div className="mt-3 rounded border border-terminal-line/60 bg-terminal-panel/20 p-3 text-xs" aria-label="图纸编辑工具">
                <div className="flex flex-wrap items-center gap-2"><span className="text-terminal-cyan">编辑工具</span>{([['brush', '画笔'], ['eyedropper', '吸管'], ['fill', '填充']] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => setEditMode(mode)} className={`min-h-9 rounded border px-2 ${editMode === mode ? 'border-terminal-green bg-terminal-green/10 text-terminal-green' : 'border-terminal-line hover:border-terminal-cyan'}`}>{label}</button>)}</div>
                <p className="mt-2 text-terminal-gray/60">{editMode === 'brush' ? '画笔：点击格子替换为右侧已选色。' : editMode === 'eyedropper' ? '吸管：点击格子以选取它的色号。' : '填充：点击一片相连的同色区域，一次替换为已选色。'}</p>
              </div>
              <section className="mt-3 rounded border border-terminal-line/60 bg-terminal-panel/20 p-3 text-xs" aria-label="图纸质量提示">
                <h3 className="text-terminal-cyan">质量提示</h3>
                <ul className="mt-2 space-y-1 text-terminal-gray/70">{assessPatternQuality(pattern, colorCount, cartoonize).map((issue) => <li key={issue.text} className={issue.tone === 'warning' ? 'text-terminal-yellow' : ''}>- {issue.text}</li>)}</ul>
              </section>
              <section className="mt-3 rounded border border-terminal-line/60 bg-terminal-panel/20 p-3 text-xs" aria-label="拼板装配图">
                <div className="flex items-center justify-between gap-2"><h3 className="text-terminal-cyan">拼板装配图</h3><span className="text-terminal-gray/60">按 {printTileSize} 格板拼接</span></div>
                <div className="mt-3 grid max-w-md gap-1" style={{ gridTemplateColumns: `repeat(${Math.ceil(pattern.width / printTileSize)}, minmax(0, 1fr))` }}>{getBoardAssembly(pattern, printTileSize).map((tile) => <button key={tile.id} type="button" onClick={() => setAssembledTiles((current) => { const next = new Set(current); next.has(tile.id) ? next.delete(tile.id) : next.add(tile.id); return next; })} className={`min-h-10 rounded border text-center ${assembledTiles.has(tile.id) ? 'border-terminal-green bg-terminal-green/15 text-terminal-green' : 'border-terminal-line bg-terminal-bg/50 hover:border-terminal-cyan'}`} title={`第 ${tile.row + 1} 行第 ${tile.column + 1} 块：${tile.width}×${tile.height} 格`}>{tile.id}<span className="block text-[10px] opacity-70">{tile.width}×{tile.height}</span></button>)}</div>
                <p className="mt-2 text-terminal-gray/60">点击标记已完成的豆板；打印页标题与这里的编号一一对应。</p>
              </section>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-terminal-line/60 pt-4">
                <button type="button" onClick={download} className="min-h-11 rounded border border-terminal-green/70 px-4 text-sm text-terminal-green transition-colors hover:bg-terminal-green/10">下载 PNG 图纸</button>
                <button type="button" onClick={exportCsv} className="min-h-11 rounded border border-terminal-cyan/70 px-4 text-sm text-terminal-cyan transition-colors hover:bg-terminal-cyan/10">导出 CSV 清单</button>
                <label className="flex min-h-11 items-center gap-2 rounded border border-terminal-line px-2 text-terminal-gray">分页 <select value={printTileSize} onChange={(event) => setPrintTileSize(Number(event.target.value))} className="bg-terminal-bg text-terminal-gray"><option value={29}>29 × 29</option><option value={58}>58 × 58</option></select></label>
                <button type="button" onClick={printPdf} className="min-h-11 rounded border border-terminal-yellow/70 px-4 text-sm text-terminal-yellow transition-colors hover:bg-terminal-yellow/10">分页打印 / PDF</button>
              </div>
            </div>
            <aside className="min-w-0" aria-label="颜色编号色卡">
              <h2 className="text-sm text-terminal-green"><span className="text-terminal-pink">$ </span>cat ./palette</h2>
              <p className="mt-2 text-xs leading-relaxed text-terminal-gray/60">按编号取豆；数量是该颜色所需的颗数，建议多备 5%。智能量化色用于预览，导入品牌色板后可按真实色号采购。</p>
              {pattern.palette[selectedColor] && <section className="mt-3 rounded border border-terminal-line/60 bg-terminal-panel/20 p-2 text-xs"><h3 className="text-terminal-cyan">色号替代建议</h3><p className="mt-1 text-terminal-gray/60">若 {pattern.palette[selectedColor].code} 缺货，可优先比较：</p><div className="mt-2 flex flex-wrap gap-1">{suggestAlternatives(pattern.palette[selectedColor], customPalette.length ? customPalette : paletteName === 'Mard 标准 221 色' ? MARD_STANDARD_PALETTE : STARTER_PALETTES[paletteName] ?? [], 3).map((color) => <span key={color.code} className="rounded border border-terminal-line px-1.5 py-1"><span className="mr-1 inline-block h-3 w-3 align-[-1px]" style={{ backgroundColor: rgbCss(color) }} />{color.code}</span>)}</div></section>}
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
