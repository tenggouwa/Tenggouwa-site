import { useCallback, useEffect, useRef, useState } from 'react';

// 终端宠物：站点右下角养的一只 ASCII 小猫。会眨眼、久没人理就打盹（夜里也睡）、
// 偶尔冒一句话；点它撸猫（localStorage 计数），右上角 × 赶走（记住）。
// 纯前端、无后端。预渲染安全：window/localStorage 只在 effect/handler 里碰。

type Mood = 'idle' | 'blink' | 'happy' | 'sleep';

const EYES: Record<Mood, string> = { idle: 'o.o', blink: '-.-', happy: '^.^', sleep: '-.-' };

const SAY_IDLE = [
  'meow~ 又有人来逛了',
  '别点我，我在 debug',
  '今天 build 绿了吗',
  '撸猫能降 cortisol，真的',
  'ls ~/treats  # empty :(',
  '我是这台终端的看门猫',
  'segfault 不怕，rm -rf 重来',
  '你今天 commit 了吗',
  '喵呜（这是一行注释）',
  'sudo 给我点小鱼干',
];
const SAY_PET = ['呼噜呼噜~', '喵♪', '再撸一下', 'best human :)', '^•ﻌ•^'];
const SAY_SLEEP = ['zzz...', 'zzz 梦见没有 bug 的代码', '......'];

const IDLE_TO_SLEEP_MS = 45_000;

function isNight(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function frame(mood: Mood): string {
  const eyes = EYES[mood];
  if (mood === 'sleep') return ` /\\_/\\  z\n( ${eyes} ) z\n  >   <`;
  return ` /\\_/\\\n( ${eyes} )\n  > ^ <`;
}

export default function TermPet() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [mood, setMood] = useState<Mood>('idle');
  const [bubble, setBubble] = useState<string | null>(null);
  const [pets, setPets] = useState(0);
  const lastActive = useRef(Date.now());
  const bubbleT = useRef<number | undefined>(undefined);
  const happyT = useRef<number | undefined>(undefined);

  useEffect(() => {
    setHidden(localStorage.getItem('pet-hidden') === '1');
    setPets(Number(localStorage.getItem('pet-count') || '0') || 0);
    if (isNight()) setMood('sleep');
    setReady(true);
  }, []);

  const showBubble = useCallback((text: string, ms = 4500) => {
    setBubble(text);
    window.clearTimeout(bubbleT.current);
    bubbleT.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  // 眨眼：idle 时每隔几秒眨一下
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m !== 'idle') return m;
          window.setTimeout(() => setMood((cur) => (cur === 'blink' ? 'idle' : cur)), 150);
          return 'blink';
        }),
      2000 + Math.random() * 1800,
    );
    return () => window.clearInterval(id);
  }, [hidden]);

  // 偶尔说话
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m === 'sleep') showBubble(pick(SAY_SLEEP), 3000);
          else if (m !== 'happy') showBubble(pick(SAY_IDLE));
          return m;
        }),
      22_000 + Math.random() * 12_000,
    );
    return () => window.clearInterval(id);
  }, [hidden, showBubble]);

  // 打盹：久没互动 / 夜里 → 睡
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m === 'happy') return m;
          if (Date.now() - lastActive.current > IDLE_TO_SLEEP_MS || isNight()) return 'sleep';
          return m === 'sleep' ? 'idle' : m;
        }),
      5000,
    );
    return () => window.clearInterval(id);
  }, [hidden]);

  const wake = useCallback(() => {
    lastActive.current = Date.now();
    setMood((m) => (m === 'sleep' ? 'idle' : m));
  }, []);

  const pet = useCallback(() => {
    lastActive.current = Date.now();
    setMood('happy');
    window.clearTimeout(happyT.current);
    happyT.current = window.setTimeout(() => setMood('idle'), 2200);
    setPets((n) => {
      const v = n + 1;
      try {
        localStorage.setItem('pet-count', String(v));
      } catch {
        /* localStorage 不可用就算了 */
      }
      return v;
    });
    showBubble(pick(SAY_PET), 2200);
  }, [showBubble]);

  const dismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setHidden(true);
    try {
      localStorage.setItem('pet-hidden', '1');
    } catch {
      /* 同上 */
    }
  }, []);

  if (!ready || hidden) return null;

  const sleeping = mood === 'sleep';
  return (
    <div className="fixed bottom-3 right-3 z-40 hidden select-none font-mono sm:block" onMouseEnter={wake}>
      {bubble && (
        <div className="mb-1 max-w-[190px] rounded border border-terminal-line/70 bg-terminal-bg/90 px-2 py-1 text-[11px] text-terminal-gray shadow-glow">
          {bubble}
        </div>
      )}
      <div className="group relative w-fit">
        <button
          type="button"
          onClick={pet}
          aria-label="撸猫"
          title={`撸了 ${pets} 次`}
          className={`block text-left text-[11px] leading-[1.15] transition-colors hover:text-terminal-green ${
            sleeping ? 'text-terminal-gray/55' : 'text-terminal-green/80'
          }`}
        >
          <pre className={`m-0 origin-bottom ${sleeping ? 'animate-pet-breathe' : 'animate-pet-idle'}`}>
            {frame(mood)}
          </pre>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="赶走猫"
          className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-terminal-line/70 bg-terminal-bg text-[9px] text-terminal-gray/60 hover:text-terminal-pink group-hover:flex"
        >
          ×
        </button>
      </div>
    </div>
  );
}
