import { useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';

interface Pt {
  x: number;
  y: number;
  ox: number;
  oy: number;
  pinned: boolean;
}

export default function Rope() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [segCount, setSegCount] = useState(40);
  const [gravity, setGravity] = useState(0.5);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let w = (canvas.width = canvas.offsetWidth * dpr);
    let h = (canvas.height = canvas.offsetHeight * dpr);
    const segLen = 14 * dpr;

    function newRope(): Pt[] {
      const pts: Pt[] = [];
      const sx = w / 2;
      const sy = 30 * dpr;
      for (let i = 0; i < segCount; i++) {
        const x = sx + i * 0.1;
        const y = sy + i * segLen;
        pts.push({ x, y, ox: x, oy: y, pinned: i === 0 });
      }
      return pts;
    }
    let pts = newRope();
    let dragIdx: number | null = null;
    const mouse = { x: w / 2, y: h / 2 };

    function update() {
      for (const p of pts) {
        if (p.pinned) continue;
        const vx = (p.x - p.ox) * 0.99;
        const vy = (p.y - p.oy) * 0.99;
        p.ox = p.x;
        p.oy = p.y;
        p.x += vx;
        p.y += vy + gravity * dpr;
      }
      // 约束迭代
      for (let iter = 0; iter < 14; iter++) {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const diff = (d - segLen) / d;
          const ox = dx * 0.5 * diff;
          const oy = dy * 0.5 * diff;
          if (!a.pinned) {
            a.x += ox;
            a.y += oy;
          }
          if (!b.pinned) {
            b.x -= ox;
            b.y -= oy;
          }
        }
        // 边界
        for (const p of pts) {
          if (p.pinned) continue;
          if (p.y > h - 4 * dpr) {
            p.y = h - 4 * dpr;
            p.oy = p.y + (p.y - p.oy) * 0.4;
          }
          if (p.x < 4 * dpr) p.x = 4 * dpr;
          if (p.x > w - 4 * dpr) p.x = w - 4 * dpr;
        }
        if (dragIdx !== null) {
          pts[dragIdx].x = mouse.x;
          pts[dragIdx].y = mouse.y;
          pts[dragIdx].ox = mouse.x;
          pts[dragIdx].oy = mouse.y;
        }
      }
    }

    let raf = 0;
    function draw() {
      if (!canvas || !ctx) return;
      ctx.fillStyle = 'rgba(11, 15, 16, 0.35)';
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#ff6ac1';
      ctx.shadowColor = 'rgba(255, 106, 193, 0.8)';
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 端点
      ctx.fillStyle = '#5af78e';
      for (const p of pts) {
        if (p.pinned) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#57c7ff';
      ctx.beginPath();
      ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      update();
      raf = requestAnimationFrame(draw);
    }
    draw();

    function getMouse(e: PointerEvent): { x: number; y: number } {
      const rect = canvas!.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
    }
    function onDown(e: PointerEvent) {
      const m = getMouse(e);
      mouse.x = m.x;
      mouse.y = m.y;
      // 抓最近的点（pin 状态点不抓）
      let best = -1;
      let bestD = 30 * dpr;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].pinned) continue;
        const d = Math.hypot(pts[i].x - m.x, pts[i].y - m.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        dragIdx = best;
        canvas!.setPointerCapture(e.pointerId);
      }
    }
    function onMove(e: PointerEvent) {
      const m = getMouse(e);
      mouse.x = m.x;
      mouse.y = m.y;
    }
    function onUp(e: PointerEvent) {
      dragIdx = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    function onResize() {
      if (!canvas) return;
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      pts = newRope();
    }
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, [segCount, gravity]);

  return (
    <LabFrame
      slug="rope"
      title="rope.verlet"
      desc="Verlet integration + 距离约束。鼠标按住拖任意节点。"
      accent="pink"
    >
      <div className="flex items-center gap-4 px-4 py-2 text-xs border-b border-terminal-line/60 flex-wrap">
        <label className="flex items-center gap-2 text-terminal-gray">
          <span className="text-terminal-pink">--segs</span>
          <input
            type="range"
            min={10}
            max={80}
            step={1}
            value={segCount}
            onChange={(e) => setSegCount(Number(e.target.value))}
            className="accent-terminal-pink"
          />
          <span className="w-8 text-right tabular-nums">{segCount}</span>
        </label>
        <label className="flex items-center gap-2 text-terminal-gray">
          <span className="text-terminal-pink">--g</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={gravity}
            onChange={(e) => setGravity(Number(e.target.value))}
            className="accent-terminal-pink"
          />
          <span className="w-10 text-right tabular-nums">{gravity.toFixed(2)}</span>
        </label>
        <span className="ml-auto text-terminal-gray/60">click + drag</span>
      </div>
      <canvas ref={ref} className="w-full h-[480px] block bg-terminal-bg cursor-grab" />
    </LabFrame>
  );
}
