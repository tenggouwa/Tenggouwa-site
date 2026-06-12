import { useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';

// 网格按字符渲染（跟 wave/donut 一脉相承）。字符越密表示逃逸越快（离集合越远）。
const W = 110;
const H = 50;
const CELL_W = 8;
const CELL_H = 14;
const RAMP = ' .,:;-=+*#%@';
// 逃逸条带循环用的终端配色，相位漂移制造 CRT 余辉感
const PALETTE = ['#5af78e', '#57c7ff', '#f3f99d', '#ff6ac1'];

const HOME = { cx: -0.5, cy: 0, unit: 3.0 / W };

export default function Mandelbrot() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ zoom: 1, iter: 0 });
  // 复位 / 缩放按钮通过这个 ref 调到 effect 内部的操作
  const apiRef = useRef<{ reset: () => void; zoom: (factor: number) => void } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * CELL_W * dpr;
    canvas.height = H * CELL_H * dpr;
    ctx.scale(dpr, dpr);
    ctx.font = `${CELL_H - 2}px JetBrains Mono, monospace`;
    ctx.textBaseline = 'top';

    // 视图状态（闭包内可变，避免 stale closure）
    let cx = HOME.cx;
    let cy = HOME.cy;
    let unit = HOME.unit;
    const iters = new Int16Array(W * H);
    let dirty = true; // 需要重算逃逸网格
    let phase = 0; // 配色相位（余辉漂移）

    const aspect = CELL_H / CELL_W; // 修正字符“高瘦”导致的纵向拉伸

    function maxIterFor(u: number): number {
      const zoomLevels = Math.log2(HOME.unit / u);
      return Math.min(600, Math.round(90 + 22 * Math.max(0, zoomLevels)));
    }

    function compute() {
      const maxIter = maxIterFor(unit);
      const stepX = unit;
      const stepY = unit * aspect;
      for (let gy = 0; gy < H; gy++) {
        const y0 = cy + (gy - H / 2) * stepY;
        for (let gx = 0; gx < W; gx++) {
          const x0 = cx + (gx - W / 2) * stepX;
          let zx = 0;
          let zy = 0;
          let n = 0;
          while (zx * zx + zy * zy <= 4 && n < maxIter) {
            const xt = zx * zx - zy * zy + x0;
            zy = 2 * zx * zy + y0;
            zx = xt;
            n++;
          }
          iters[gy * W + gx] = n === maxIter ? -1 : n;
        }
      }
      setHud({ zoom: HOME.unit / unit, iter: maxIter });
    }

    function draw() {
      if (!ctx) return;
      const maxIter = maxIterFor(unit);
      ctx.fillStyle = '#0b0f10';
      ctx.fillRect(0, 0, W * CELL_W, H * CELL_H);
      for (let gy = 0; gy < H; gy++) {
        for (let gx = 0; gx < W; gx++) {
          const n = iters[gy * W + gx];
          if (n < 0) continue; // 集合内部 → 留黑
          const t = Math.sqrt(n / maxIter); // 压缩低迭代区，边缘更细腻
          const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
          if (ch === ' ') continue;
          ctx.fillStyle = PALETTE[(((n >> 1) + phase) % PALETTE.length + PALETTE.length) % PALETTE.length];
          ctx.fillText(ch, gx * CELL_W, gy * CELL_H);
        }
      }
    }

    let raf = 0;
    let last = 0;
    function loop(ts: number) {
      if (dirty) {
        compute();
        dirty = false;
        draw();
        last = ts;
      } else if (ts - last > 110) {
        // 慢速相位漂移：余辉感而不烧 CPU
        phase = (phase + 1) % PALETTE.length;
        draw();
        last = ts;
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // ---- 交互：点击放大、拖动平移 ----
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let panning = false;

    function cellStep() {
      return { sx: unit, sy: unit * aspect };
    }

    function onDown(e: PointerEvent) {
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      moved = false;
      panning = true;
      canvas!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!panning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
      const rect = canvas!.getBoundingClientRect();
      const { sx, sy } = cellStep();
      // 屏幕位移换算成复平面位移（按缩放比例）
      cx -= (dx / rect.width) * W * sx;
      cy -= (dy / rect.height) * H * sy;
      lastX = e.clientX;
      lastY = e.clientY;
      dirty = true;
    }
    function onUp(e: PointerEvent) {
      panning = false;
      canvas!.releasePointerCapture(e.pointerId);
      if (moved) return;
      // 没拖动 = 点击：以点击点为中心放大（shift / 右键则缩小）
      const rect = canvas!.getBoundingClientRect();
      const gx = ((e.clientX - rect.left) / rect.width) * W;
      const gy = ((e.clientY - rect.top) / rect.height) * H;
      const { sx, sy } = cellStep();
      cx += (gx - W / 2) * sx;
      cy += (gy - H / 2) * sy;
      unit *= e.shiftKey ? 2 : 0.5;
      dirty = true;
    }
    function onContext(e: Event) {
      e.preventDefault();
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onContext);

    apiRef.current = {
      reset: () => {
        cx = HOME.cx;
        cy = HOME.cy;
        unit = HOME.unit;
        dirty = true;
      },
      zoom: (factor: number) => {
        unit *= factor;
        dirty = true;
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onContext);
      apiRef.current = null;
    };
  }, []);

  const zoomLabel =
    hud.zoom >= 1000 ? hud.zoom.toExponential(1) : hud.zoom.toFixed(hud.zoom < 10 ? 1 : 0);

  return (
    <LabFrame
      slug="mandelbrot"
      title="mandelbrot.ascii"
      desc="逃逸时间分形，按字符密度渲染。点击放大、shift+点击缩小、拖动平移。"
      accent="green"
    >
      <div className="bg-terminal-bg">
        <div className="flex items-center gap-3 border-b border-terminal-line/60 px-4 py-2 text-xs text-terminal-gray/80">
          <span>
            zoom <span className="text-terminal-green">{zoomLabel}×</span>
          </span>
          <span>
            iter <span className="text-terminal-cyan">{hud.iter}</span>
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => apiRef.current?.zoom(0.5)}
              className="rounded border border-terminal-line/70 px-2 py-0.5 hover:border-terminal-green/60 hover:text-terminal-green transition-colors"
            >
              zoom+
            </button>
            <button
              type="button"
              onClick={() => apiRef.current?.zoom(2)}
              className="rounded border border-terminal-line/70 px-2 py-0.5 hover:border-terminal-cyan/60 hover:text-terminal-cyan transition-colors"
            >
              zoom−
            </button>
            <button
              type="button"
              onClick={() => apiRef.current?.reset()}
              className="rounded border border-terminal-line/70 px-2 py-0.5 hover:border-terminal-pink/60 hover:text-terminal-pink transition-colors"
            >
              reset
            </button>
          </span>
        </div>
        <div className="p-4 overflow-x-auto">
          <canvas
            ref={ref}
            style={{ width: W * CELL_W, height: H * CELL_H }}
            className="cursor-crosshair block max-w-full touch-none select-none"
          />
        </div>
      </div>
    </LabFrame>
  );
}
