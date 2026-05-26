import { useEffect, useState } from 'react';

// 老式 CRT 开机序列：扫描线 + 一道通电亮线 + 逐行滚动的 boot log，结束淡出。
const LINES = [
  'tenggouwa BIOS v4.7 — POST ............ OK',
  '[  OK  ] Mounted /dev/posts',
  '[  OK  ] Loaded modules: react vite tailwind arco',
  '[  OK  ] Reticulating splines',
  '[  OK  ] Started terminal session @tenggouwa',
  '[  OK  ] Spawning shell',
  '',
  '~$ welcome',
];

export default function BootScreen({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (n < LINES.length) {
      const t = setTimeout(() => setN((v) => v + 1), 170);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setFading(true), 480);
    const t2 = setTimeout(onDone, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [n, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-terminal-bg transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* CRT 扫描线 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {/* 通电亮线 */}
      <div className="animate-blink pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-terminal-green/40 shadow-glow" />

      <pre className="relative w-full max-w-xl whitespace-pre-wrap px-6 font-mono text-xs leading-relaxed sm:text-sm">
        {LINES.slice(0, n).map((line, i) => {
          const isOk = line.startsWith('[  OK  ]');
          const isPrompt = line.startsWith('~$');
          return (
            <div key={i}>
              {isOk ? (
                <>
                  <span className="text-terminal-green">[  OK  ]</span>
                  <span className="text-terminal-gray/80">{line.slice(8)}</span>
                </>
              ) : (
                <span className={isPrompt ? 'text-terminal-cyan' : 'text-terminal-gray/70'}>{line}</span>
              )}
            </div>
          );
        })}
        {n >= LINES.length && <span className="animate-blink text-terminal-green">█</span>}
      </pre>
    </div>
  );
}
