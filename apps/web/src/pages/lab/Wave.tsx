import { useEffect, useRef } from 'react';
import LabFrame from './LabFrame';

const W = 80;
const H = 36;
const CHARS = ' .,:;-=+*#%@';

export default function Wave() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cellW = 10;
    const cellH = 16;
    canvas.width = W * cellW * dpr;
    canvas.height = H * cellH * dpr;
    ctx.scale(dpr, dpr);
    ctx.font = `${cellH - 2}px JetBrains Mono, monospace`;
    ctx.textBaseline = 'top';

    let u = new Float32Array(W * H);
    let uPrev = new Float32Array(W * H);
    let uNext = new Float32Array(W * H);

    function poke(cx: number, cy: number, strength: number) {
      const r = 2;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          u[y * W + x] += strength * (1 - d / r);
        }
      }
    }

    // 初始随机几道涟漪
    for (let i = 0; i < 3; i++) {
      poke(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 2.5);
    }

    let raf = 0;
    let tick = 0;
    function step() {
      if (!canvas || !ctx) return;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const lap = u[i - 1] + u[i + 1] + u[i - W] + u[i + W] - 4 * u[i];
          uNext[i] = 2 * u[i] - uPrev[i] + 0.42 * lap;
          uNext[i] *= 0.992;
        }
      }
      const swap = uPrev;
      uPrev = u;
      u = uNext;
      uNext = swap;

      // 偶尔随机注入小涟漪，避免静止
      tick++;
      if (tick % 180 === 0) {
        poke(
          Math.floor(Math.random() * (W - 4)) + 2,
          Math.floor(Math.random() * (H - 4)) + 2,
          1.5 + Math.random(),
        );
      }

      // 渲染
      ctx.fillStyle = '#0b0f10';
      ctx.fillRect(0, 0, W * cellW, H * cellH);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = u[y * W + x];
          const m = Math.min(1, Math.abs(v));
          if (m < 0.02) continue;
          const idx = Math.min(CHARS.length - 1, Math.floor(m * CHARS.length));
          const ch = CHARS[idx];
          // 正负振幅给冷暖色：青 / 粉
          const hue = v > 0 ? 180 : 320;
          const sat = 80;
          const light = 40 + m * 40;
          ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
          ctx.fillText(ch, x * cellW, y * cellH);
        }
      }
      raf = requestAnimationFrame(step);
    }
    step();

    function pokeFromEvent(e: PointerEvent, strength: number) {
      const rect = canvas!.getBoundingClientRect();
      const cx = Math.floor(((e.clientX - rect.left) / rect.width) * W);
      const cy = Math.floor(((e.clientY - rect.top) / rect.height) * H);
      poke(cx, cy, strength);
    }
    function onDown(e: PointerEvent) {
      pokeFromEvent(e, 4);
    }
    function onMove(e: PointerEvent) {
      // 移动按住时持续注入
      if ((e.buttons & 1) === 0) return;
      pokeFromEvent(e, 1.2);
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <LabFrame
      slug="wave"
      title="wave.field"
      desc="2D 波动方程 + 阻尼。点击 / 拖动注入涟漪，正负振幅用冷暖色区分。"
      accent="cyan"
    >
      <div className="p-4 bg-terminal-bg overflow-x-auto">
        <canvas
          ref={ref}
          style={{ width: W * 10, height: H * 16 }}
          className="cursor-crosshair block max-w-full touch-none"
        />
      </div>
    </LabFrame>
  );
}
