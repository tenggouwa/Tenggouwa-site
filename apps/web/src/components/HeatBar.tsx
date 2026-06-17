// 阅读热力条：用 ▓/░ 方块画一条 sparkline，热度越高填得越满。
// ratio 用 sqrt 软化，避免单篇爆款把其它都压成空条。

const CELLS = 7;

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

interface HeatBarProps {
  pv: number;
  max: number;
}

export default function HeatBar({ pv, max }: HeatBarProps) {
  const ratio = max > 0 ? Math.sqrt(pv / max) : 0;
  const filled = Math.max(1, Math.min(CELLS, Math.round(ratio * CELLS)));
  const hot = ratio >= 0.78;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] leading-none"
      title={`${pv.toLocaleString()} reads`}
    >
      <span className="tracking-tighter">
        <span className={hot ? 'text-terminal-yellow' : 'text-terminal-green/90'}>{'▓'.repeat(filled)}</span>
        <span className="text-terminal-line/60">{'░'.repeat(CELLS - filled)}</span>
      </span>
      <span className="text-terminal-gray/55 tabular-nums">{compact.format(pv)}</span>
    </span>
  );
}
