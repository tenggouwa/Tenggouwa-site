import { useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';

// Gray-Scott 反应扩散：两种化学物 U/V 扩散 + 反应，自组织出珊瑚 / 分裂 / 斑点纹理。
// 按字符密度渲染（跟 wave/donut 一脉相承），V 浓度越高字符越密、越偏青。
const W = 100;
const H = 48;
const CELL_W = 8;
const CELL_H = 12;
const RAMP = ' .,:;-=+*#%@';
const DU = 0.16;
const DV = 0.08;
const SUBSTEPS = 8; // 每帧多跑几步，演化看得见

interface Preset {
  name: string;
  f: number;
  k: number;
}
const PRESETS: Preset[] = [
  { name: 'coral', f: 0.0545, k: 0.062 },
  { name: 'mitosis', f: 0.0367, k: 0.0649 },
  { name: 'spots', f: 0.03, k: 0.062 },
  { name: 'maze', f: 0.029, k: 0.057 },
];

export default function Reaction() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [preset, setPreset] = useState(0);
  // seed / 切预设的操作暴露给按钮
  const apiRef = useRef<{ seed: () => void; setPreset: (i: number) => void } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * CELL_W * dpr;
    canvas.height = H * CELL_H * dpr;
    ctx.scale(dpr, dpr);
    ctx.font = `${CELL_H - 1}px JetBrains Mono, monospace`;
    ctx.textBaseline = 'top';

    let u = new Float32Array(W * H);
    let v = new Float32Array(W * H);
    let uNext = new Float32Array(W * H);
    let vNext = new Float32Array(W * H);
    let f = PRESETS[0].f;
    let k = PRESETS[0].k;

    function seed() {
      u.fill(1);
      v.fill(0);
      // 中心几块 V + 随机扰动，破坏对称
      for (let i = 0; i < 12; i++) {
        const cx = Math.floor(W * (0.3 + 0.4 * Math.random()));
        const cy = Math.floor(H * (0.3 + 0.4 * Math.random()));
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            v[y * W + x] = 0.5 + 0.2 * Math.random();
            u[y * W + x] = 0.25;
          }
        }
      }
    }
    seed();

    function inject(cx: number, cy: number) {
      const r = 2;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          v[y * W + x] = 0.6;
          u[y * W + x] = 0.2;
        }
      }
    }

    function step() {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const lapU = u[i - 1] + u[i + 1] + u[i - W] + u[i + W] - 4 * u[i];
          const lapV = v[i - 1] + v[i + 1] + v[i - W] + v[i + W] - 4 * v[i];
          const uvv = u[i] * v[i] * v[i];
          uNext[i] = u[i] + (DU * lapU - uvv + f * (1 - u[i]));
          vNext[i] = v[i] + (DV * lapV + uvv - (f + k) * v[i]);
        }
      }
      // 边界保持初值，避免数值跑飞
      let tmp = u;
      u = uNext;
      uNext = tmp;
      tmp = v;
      v = vNext;
      vNext = tmp;
    }

    let raf = 0;
    function frame() {
      if (!ctx) return;
      for (let s = 0; s < SUBSTEPS; s++) step();

      ctx.fillStyle = '#0b0f10';
      ctx.fillRect(0, 0, W * CELL_W, H * CELL_H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const val = v[y * W + x];
          const m = Math.min(1, val / 0.4);
          if (m < 0.06) continue;
          const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(m * RAMP.length))];
          // 绿 → 青 渐变，亮度随浓度
          const hue = 145 + m * 55;
          const light = 32 + m * 42;
          ctx.fillStyle = `hsl(${hue}, 78%, ${light}%)`;
          ctx.fillText(ch, x * CELL_W, y * CELL_H);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ---- 交互：点击 / 拖动注入 V ----
    function eventCell(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const cx = Math.floor(((e.clientX - rect.left) / rect.width) * W);
      const cy = Math.floor(((e.clientY - rect.top) / rect.height) * H);
      return { cx, cy };
    }
    function onDown(e: PointerEvent) {
      const { cx, cy } = eventCell(e);
      inject(cx, cy);
      canvas!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if ((e.buttons & 1) === 0) return;
      const { cx, cy } = eventCell(e);
      inject(cx, cy);
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);

    apiRef.current = {
      seed,
      setPreset: (i: number) => {
        f = PRESETS[i].f;
        k = PRESETS[i].k;
        seed();
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      apiRef.current = null;
    };
  }, []);

  return (
    <LabFrame
      slug="reaction"
      title="reaction.diffusion"
      desc="Gray-Scott 反应扩散。化学物自组织出有机纹理，点击 / 拖动注入，切换预设看不同形态。"
      accent="cyan"
    >
      <div className="bg-terminal-bg">
        <div className="flex flex-wrap items-center gap-2 border-b border-terminal-line/60 px-4 py-2 text-xs text-terminal-gray/80">
          <span className="mr-1">preset</span>
          {PRESETS.map((p, i) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setPreset(i);
                apiRef.current?.setPreset(i);
              }}
              className={`rounded border px-2 py-0.5 transition-colors ${
                i === preset
                  ? 'border-terminal-cyan/60 text-terminal-cyan'
                  : 'border-terminal-line/70 hover:border-terminal-cyan/40'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => apiRef.current?.seed()}
            className="ml-auto rounded border border-terminal-line/70 px-2 py-0.5 hover:border-terminal-pink/60 hover:text-terminal-pink transition-colors"
          >
            reseed
          </button>
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
