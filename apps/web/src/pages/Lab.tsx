import { useEffect, useRef } from 'react';

export default function Lab() {
  return (
    <div className="space-y-6">
      <h1 className="text-terminal-pink text-2xl">
        <span className="text-terminal-pink">$ </span>./lab --interactive
      </h1>
      <p className="text-sm text-terminal-gray">
        前端小实验，随手放一些好玩的东西。下面是一个 canvas 粒子背景占位 demo。
      </p>
      <div className="rounded-lg overflow-hidden border border-terminal-line/70 bg-terminal-panel/30">
        <ParticleCanvas />
      </div>
    </div>
  );
}

function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
    let height = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);

    interface P {
      x: number;
      y: number;
      vx: number;
      vy: number;
    }
    const particles: P[] = Array.from({ length: 80 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
    }));

    let raf = 0;
    function step() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(90, 247, 142, 0.85)';
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(87, 199, 255, 0.15)';
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 90 * window.devicePixelRatio) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(step);
    }
    step();

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      height = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="w-full h-[320px] block" />;
}
