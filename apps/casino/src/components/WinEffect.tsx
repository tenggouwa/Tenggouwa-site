// 通用中奖特效：霓虹粒子迸发 + 放大发光的 WIN +X + 一道光晕闪。
// 用法：在游戏画布容器里 `{result?.outcome === 'win' && <WinEffect key={rollKey} amount={net} />}`，
// 靠 key 变化重挂载来重放动画。纯 DOM/CSS，三个游戏共用。

import { useMemo } from 'react';

const COLORS = ['#5af78e', '#57c7ff', '#ff6ac1', '#f3f99d'];

export default function WinEffect({ amount, big = false }: { amount: number; big?: boolean }) {
  const particles = useMemo(() => {
    const n = big ? 48 : 28;
    return Array.from({ length: n }, (_, i) => {
      const ang = Math.random() * Math.PI * 2;
      const dist = (big ? 120 : 80) + Math.random() * (big ? 240 : 160);
      return {
        tx: Math.cos(ang) * dist,
        ty: Math.sin(ang) * dist,
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.12,
        size: 5 + Math.random() * 6,
      };
    });
  }, [amount, big]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          animation: 'winFlash 0.9s ease-out forwards',
          background: 'radial-gradient(circle at 50% 44%, rgba(90,247,142,0.28), transparent 62%)',
        }}
      />
      <div className="absolute left-1/2 top-[44%]">
        {particles.map((p, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                width: p.size,
                height: p.size,
                background: p.color,
                borderRadius: 2,
                boxShadow: `0 0 8px ${p.color}`,
                '--tx': `${p.tx}px`,
                '--ty': `${p.ty}px`,
                animation: `winParticle ${big ? 1.3 : 1.1}s ${p.delay}s ease-out forwards`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div
        className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ animation: 'winPop 1.3s ease-out forwards' }}
      >
        <div
          className={(big ? 'text-5xl' : 'text-3xl') + ' font-bold tracking-widest text-terminal-green'}
          style={{ textShadow: '0 0 20px rgba(90,247,142,0.85)' }}
        >
          WIN
        </div>
        <div
          className={(big ? 'text-3xl' : 'text-2xl') + ' font-bold text-terminal-yellow'}
          style={{ textShadow: '0 0 14px rgba(243,249,157,0.75)' }}
        >
          +{amount}
        </div>
      </div>
    </div>
  );
}
