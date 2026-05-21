import { useEffect, useRef } from 'react';
import LabFrame from './LabFrame';

const GLYPHS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF$+*/=<>'.split(
    '',
  );

export default function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const fontSize = 16;
    let cols = 0;
    let drops: number[] = [];
    let speeds: number[] = [];

    function resize() {
      if (!canvas || !ctx) return;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      cols = Math.floor(canvas.width / (fontSize * dpr));
      drops = Array.from({ length: cols }, () => Math.random() * -50);
      speeds = Array.from({ length: cols }, () => 0.6 + Math.random() * 0.9);
      ctx.fillStyle = '#0b0f10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    resize();

    let raf = 0;
    function step() {
      if (!canvas || !ctx) return;
      // 半透明黑，制造拖尾
      ctx.fillStyle = 'rgba(11, 15, 16, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${fontSize * dpr}px JetBrains Mono, monospace`;
      ctx.textBaseline = 'top';

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * fontSize * dpr;
        const y = drops[i] * fontSize * dpr;

        // 头部更亮 + glow
        ctx.shadowColor = '#5af78e';
        ctx.shadowBlur = 8 * dpr;
        ctx.fillStyle = '#d6ffe5';
        ctx.fillText(ch, x, y);

        // 尾巴
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(90, 247, 142, 0.55)';
        ctx.fillText(
          GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          x,
          y - fontSize * dpr,
        );

        drops[i] += speeds[i];
        if (drops[i] * fontSize * dpr > canvas.height && Math.random() > 0.975) {
          drops[i] = Math.random() * -20;
          speeds[i] = 0.6 + Math.random() * 0.9;
        }
      }
      raf = requestAnimationFrame(step);
    }
    step();

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <LabFrame
      slug="matrix"
      title="matrix-rain"
      desc="Cyberdeck 标配。canvas 2d + glow + 半透明拖尾。"
      accent="green"
    >
      <canvas ref={ref} className="w-full h-[480px] block bg-terminal-bg" />
    </LabFrame>
  );
}
