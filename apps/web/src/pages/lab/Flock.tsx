import { useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';

interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
}

export default function Flock() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(120);
  const [attract, setAttract] = useState(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let w = (canvas.width = canvas.offsetWidth * dpr);
    let h = (canvas.height = canvas.offsetHeight * dpr);
    const mouse = { x: w / 2, y: h / 2, active: false };

    const boids: Boid[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      hue: 140 + Math.random() * 60, // 绿~青
    }));

    const PERCEPTION = 60 * dpr;
    const MAX_SPEED = 2.4 * dpr;
    const MAX_FORCE = 0.05 * dpr;

    function limit(vx: number, vy: number, max: number): [number, number] {
      const m = Math.hypot(vx, vy);
      if (m > max) return [(vx / m) * max, (vy / m) * max];
      return [vx, vy];
    }

    let raf = 0;
    function step() {
      if (!canvas || !ctx) return;
      // 半透明黑，制造拖尾发光
      ctx.fillStyle = 'rgba(11, 15, 16, 0.18)';
      ctx.fillRect(0, 0, w, h);

      for (const b of boids) {
        let alignX = 0;
        let alignY = 0;
        let cohX = 0;
        let cohY = 0;
        let sepX = 0;
        let sepY = 0;
        let neighbors = 0;

        for (const o of boids) {
          if (o === b) continue;
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < PERCEPTION && d > 0) {
            alignX += o.vx;
            alignY += o.vy;
            cohX += o.x;
            cohY += o.y;
            sepX -= dx / d;
            sepY -= dy / d;
            neighbors++;
          }
        }

        let ax = 0;
        let ay = 0;
        if (neighbors > 0) {
          alignX /= neighbors;
          alignY /= neighbors;
          [alignX, alignY] = limit(alignX, alignY, MAX_SPEED);
          ax += (alignX - b.vx) * 0.05;
          ay += (alignY - b.vy) * 0.05;

          cohX = cohX / neighbors - b.x;
          cohY = cohY / neighbors - b.y;
          [cohX, cohY] = limit(cohX, cohY, MAX_SPEED);
          ax += (cohX - b.vx) * 0.02;
          ay += (cohY - b.vy) * 0.02;

          [sepX, sepY] = limit(sepX * 6, sepY * 6, MAX_SPEED);
          ax += (sepX - b.vx) * 0.08;
          ay += (sepY - b.vy) * 0.08;
        }

        if (mouse.active) {
          const dx = mouse.x - b.x;
          const dy = mouse.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          const sign = attract ? 1 : -1;
          ax += sign * (dx / d) * 0.15;
          ay += sign * (dy / d) * 0.15;
        }

        [ax, ay] = limit(ax, ay, MAX_FORCE);
        b.vx += ax;
        b.vy += ay;
        [b.vx, b.vy] = limit(b.vx, b.vy, MAX_SPEED);
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < 0) b.x += w;
        if (b.x > w) b.x -= w;
        if (b.y < 0) b.y += h;
        if (b.y > h) b.y -= h;

        const a = Math.atan2(b.vy, b.vx);
        const r = 5 * dpr;
        ctx.fillStyle = `hsl(${b.hue}, 90%, 65%)`;
        ctx.shadowColor = `hsl(${b.hue}, 95%, 60%)`;
        ctx.shadowBlur = 12 * dpr;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
        ctx.lineTo(
          b.x + Math.cos(a + 2.6) * r * 0.6,
          b.y + Math.sin(a + 2.6) * r * 0.6,
        );
        ctx.lineTo(
          b.x + Math.cos(a - 2.6) * r * 0.6,
          b.y + Math.sin(a - 2.6) * r * 0.6,
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // 鼠标光斑
      if (mouse.active) {
        const grd = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          80 * dpr,
        );
        grd.addColorStop(0, attract ? 'rgba(255, 106, 193, 0.35)' : 'rgba(87, 199, 255, 0.35)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 80 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    }
    step();

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * dpr;
      mouse.y = (e.clientY - rect.top) * dpr;
      mouse.active = true;
    }
    function onLeave() {
      mouse.active = false;
    }
    function onResize() {
      if (!canvas) return;
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    }
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [count, attract]);

  return (
    <LabFrame
      slug="flock"
      title="flock.boids"
      desc="separation / alignment / cohesion 三规则。鼠标进场变成吸引子。"
      accent="cyan"
    >
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-terminal-gray border-b border-terminal-line/60 flex-wrap">
        <label className="flex items-center gap-2">
          <span className="text-terminal-cyan">--count</span>
          <input
            type="range"
            min={30}
            max={300}
            step={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="accent-terminal-cyan"
          />
          <span className="w-8 text-right tabular-nums">{count}</span>
        </label>
        <button
          type="button"
          onClick={() => setAttract((v) => !v)}
          className="border border-terminal-line/70 rounded px-2 py-1 hover:border-terminal-cyan/60 transition-colors"
        >
          <span className="text-terminal-pink">--mode=</span>
          {attract ? 'attract' : 'repel'}
        </button>
        <span className="text-terminal-gray/60 ml-auto">move mouse over canvas</span>
      </div>
      <canvas ref={ref} className="w-full h-[480px] block bg-terminal-bg" />
    </LabFrame>
  );
}
