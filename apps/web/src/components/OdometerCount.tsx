import { useEffect, useState } from 'react';

// 终端风滚动计数器：载入时每一位数字像里程表一样从 0 滚到目标值，
// 个位最先停、高位依次延后，做出级联滚动感。纯 CSS transform，不依赖动画库。

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function RollingDigit({ target, delay }: { target: number; delay: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setShown(target), delay);
    return () => clearTimeout(id);
  }, [target, delay]);
  return (
    <span className="inline-block h-[1.1em] overflow-hidden align-bottom" aria-hidden="true">
      <span
        className="flex flex-col transition-transform duration-700 ease-out"
        style={{ transform: `translateY(-${shown * 1.1}em)` }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="h-[1.1em] leading-[1.1em]">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

interface OdometerCountProps {
  value: number;
  className?: string;
}

export default function OdometerCount({ value, className }: OdometerCountProps) {
  const chars = value.toLocaleString('en-US').split('');
  const digitCount = chars.filter((c) => c >= '0' && c <= '9').length;
  let seen = 0;
  return (
    <span className={className} role="text" aria-label={String(value)}>
      {chars.map((c, i) => {
        if (c < '0' || c > '9') {
          return (
            <span key={i} aria-hidden="true">
              {c}
            </span>
          );
        }
        // 个位（最右数字）delay 最小，越往高位 delay 越大 → 级联滚动
        const fromRight = digitCount - 1 - seen;
        seen += 1;
        return <RollingDigit key={i} target={Number(c)} delay={fromRight * 90} />;
      })}
    </span>
  );
}
