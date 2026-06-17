// 自绘 SVG 输赢曲线：balance 随局数变化。下行染红、上行染绿，标出初始线。

import { useMemo } from 'react';
import type { CurvePoint } from '../lib/types';

const INITIAL = 1000;

export default function Curve({ points, height = 180 }: { points: CurvePoint[]; height?: number }) {
  const width = 640;
  const pad = 8;

  const path = useMemo(() => {
    if (points.length === 0) return null;
    const balances = points.map((p) => p.balance_after);
    const max = Math.max(INITIAL, ...balances);
    const min = Math.min(0, ...balances);
    const range = Math.max(1, max - min);
    const n = points.length;
    const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (width - 2 * pad);
    const y = (v: number) => pad + (1 - (v - min) / range) * (height - 2 * pad);

    const line = balances.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(n - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
    const initialY = y(INITIAL);
    const last = balances[balances.length - 1];
    const down = last < INITIAL;
    return { line, area, initialY, down, last };
  }, [points, height]);

  if (!path) {
    return (
      <div className="flex items-center justify-center rounded border border-terminal-line/60 bg-terminal-bg/40 py-12 text-xs text-terminal-gray/50">
        还没有记录，去玩两局就有曲线了
      </div>
    );
  }

  const stroke = path.down ? '#ff5f57' : '#5af78e';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 初始积分基准线 */}
      <line
        x1={pad}
        x2={width - pad}
        y1={path.initialY}
        y2={path.initialY}
        stroke="#8a9199"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.4"
      />
      <path d={path.area} fill="url(#curveFill)" />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
