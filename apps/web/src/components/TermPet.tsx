import { useCallback, useEffect, useRef, useState } from 'react';

// 终端宠物：站点右下角养的一只 ASCII 小猫（裸着、无背景框）。
// 会呼吸/眨眼、身体朝光标偏（像在看你）、偶尔伸懒腰、溜达几步、夜里/久没人理就打盹；
// 还会偷看你的 GitHub：最近 push 多 → 精神，好久没 commit → 蔫。
// 点它撸猫（localStorage 计数），右上角 × 赶走（记住）。纯前端、预渲染安全。

type Mood = 'idle' | 'blink' | 'happy' | 'sleep' | 'stretch';
type Git = 'energetic' | 'normal' | 'sleepy';

const EYES: Record<Mood, string> = { idle: 'o.o', blink: '-.-', happy: '^.^', sleep: '-.-', stretch: '>.<' };

const SAY_IDLE = [
  'meow~ 又有人来逛了',
  '别点我，我在 debug',
  '撸猫能降 cortisol，真的',
  'ls ~/treats  # empty :(',
  '我是这台终端的看门猫',
  'segfault 不怕，rm -rf 重来',
  '喵呜（这是一行注释）',
  'sudo 给我点小鱼干',
];
const SAY_PET = ['呼噜呼噜~', '喵♪', '再撸一下', 'best human :)', '^•ﻌ•^'];
const SAY_SLEEP = ['zzz...', 'zzz 梦见没有 bug 的代码', '......'];
const SAY_GIT: Record<Git, string> = {
  energetic: '你最近 push 很勤嘛 ✦',
  normal: '今天 build 绿了吗',
  sleepy: '好久没看你 commit 了…',
};

function isNight(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function frame(mood: Mood): string {
  const e = EYES[mood];
  const head = mood === 'sleep' ? ' /\\_/\\  z' : ' /\\_/\\';
  const eyes = mood === 'sleep' ? `( ${e} ) z` : `( ${e} )`;
  const mouth = mood === 'stretch' ? '  ~~~ ' : mood === 'sleep' ? '  >   <' : '  > ^ <';
  return `${head}\n${eyes}\n${mouth}`;
}

export default function TermPet() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [mood, setMood] = useState<Mood>('idle');
  const [bubble, setBubble] = useState<string | null>(null);
  const [pets, setPets] = useState(0);
  const [git, setGit] = useState<Git>('normal');

  const lastActive = useRef(Date.now());
  const lastMouseMove = useRef(0);
  const leanTarget = useRef(0);
  const leanCur = useRef(0);
  const walk = useRef({ x: 0, until: 0, dir: -1 });
  const catRef = useRef<HTMLDivElement>(null);
  const bubbleT = useRef<number | undefined>(undefined);
  const happyT = useRef<number | undefined>(undefined);

  useEffect(() => {
    setHidden(localStorage.getItem('pet-hidden') === '1');
    setPets(Number(localStorage.getItem('pet-count') || '0') || 0);
    if (isNight()) setMood('sleep');
    setReady(true);
  }, []);

  // 偷看 GitHub：最近一次 push 距今多久 → 精神状态
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    fetch('https://api.github.com/users/tenggouwa/events/public?per_page=30')
      .then((r) => (r.ok ? r.json() : []))
      .then((events: Array<{ type: string; created_at: string }>) => {
        if (!alive || !Array.isArray(events)) return;
        const push = events.find((e) => e.type === 'PushEvent');
        if (!push) return;
        const days = (Date.now() - new Date(push.created_at).getTime()) / 86_400_000;
        setGit(days < 2 ? 'energetic' : days > 7 ? 'sleepy' : 'normal');
      })
      .catch(() => {
        /* 限流/网络问题就维持 normal */
      });
    return () => {
      alive = false;
    };
  }, [hidden]);

  const showBubble = useCallback((text: string, ms = 4500) => {
    setBubble(text);
    window.clearTimeout(bubbleT.current);
    bubbleT.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  // 光标位置 → 身体偏向（像在看你）
  useEffect(() => {
    if (hidden) return;
    const onMove = (e: MouseEvent) => {
      lastMouseMove.current = Date.now();
      const el = catRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      leanTarget.current = Math.max(-14, Math.min(14, dx / 28));
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [hidden]);

  // rAF：统一驱动 transform —— 呼吸(上下) + 偏头(朝光标，闲时慢摇) + 溜达(左右)
  useEffect(() => {
    if (hidden) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const breathe = Math.sin(t * 1.7) * 1.4;
      const mouseIdle = Date.now() - lastMouseMove.current > 2000;
      const leanGoal = mouseIdle ? Math.sin(t * 0.7) * 4 : leanTarget.current;
      leanCur.current += (leanGoal - leanCur.current) * 0.07;

      const w = walk.current;
      if (now > w.until && Math.random() < 0.0016) {
        w.until = now + 1700;
        w.dir = Math.random() < 0.5 ? -1 : 1;
      }
      const targetX = now < w.until ? w.dir * 22 : 0;
      w.x += (targetX - w.x) * 0.06;

      const el = catRef.current;
      if (el) {
        el.style.transform = `translate(${w.x.toFixed(1)}px, ${breathe.toFixed(1)}px) rotate(${leanCur.current.toFixed(1)}deg)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hidden]);

  // 眨眼
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m !== 'idle') return m;
          window.setTimeout(() => setMood((c) => (c === 'blink' ? 'idle' : c)), 150);
          return 'blink';
        }),
      2000 + Math.random() * 1800,
    );
    return () => window.clearInterval(id);
  }, [hidden]);

  // 偶尔伸懒腰
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m !== 'idle') return m;
          window.setTimeout(() => setMood((c) => (c === 'stretch' ? 'idle' : c)), 1400);
          return 'stretch';
        }),
      12_000 + Math.random() * 9000,
    );
    return () => window.clearInterval(id);
  }, [hidden]);

  // 偶尔说话（醒着 idle 话题，睡着说梦话，偶尔提一句 GitHub）
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m === 'sleep') showBubble(pick(SAY_SLEEP), 3000);
          else if (m !== 'happy') showBubble(Math.random() < 0.3 ? SAY_GIT[git] : pick(SAY_IDLE));
          return m;
        }),
      20_000 + Math.random() * 12_000,
    );
    return () => window.clearInterval(id);
  }, [hidden, showBubble, git]);

  // 打盹：久没互动 / 夜里 → 睡（蔫的时候更快睡，精神时撑更久）
  useEffect(() => {
    if (hidden) return;
    const id = window.setInterval(
      () =>
        setMood((m) => {
          if (m === 'happy' || m === 'stretch') return m;
          const thr = git === 'sleepy' ? 25_000 : git === 'energetic' ? 80_000 : 45_000;
          if (Date.now() - lastActive.current > thr || isNight()) return 'sleep';
          return m === 'sleep' ? 'idle' : m;
        }),
      5000,
    );
    return () => window.clearInterval(id);
  }, [hidden, git]);

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
    <div className="fixed bottom-4 right-5 z-40 hidden select-none font-mono sm:block" onMouseEnter={wake}>
      {bubble && (
        <div className="mb-1.5 ml-1 w-fit max-w-[210px] rounded border border-terminal-line/60 bg-terminal-bg/85 px-2 py-1 text-[11px] text-terminal-gray backdrop-blur-sm">
          {bubble}
        </div>
      )}
      <div className="group relative w-fit">
        <div ref={catRef} className="will-change-transform">
          <button
            type="button"
            onClick={pet}
            aria-label="撸猫"
            title={`撸了 ${pets} 次`}
            className={`block cursor-pointer border-0 bg-transparent p-0 text-left text-base leading-[1.2] transition-colors hover:text-terminal-green ${
              sleeping ? 'text-terminal-gray/55' : 'text-terminal-green/85'
            }`}
          >
            <pre className="m-0">{frame(mood)}</pre>
          </button>
          {!sleeping && (
            <span className="animate-pet-tail pointer-events-none absolute -right-2 bottom-1 origin-bottom-left text-base leading-none text-terminal-green/70">
              ~
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="赶走猫"
          className="absolute -right-3 -top-2 hidden h-4 w-4 items-center justify-center rounded-full border border-terminal-line/70 bg-terminal-bg text-[9px] text-terminal-gray/60 hover:text-terminal-pink group-hover:flex"
        >
          ×
        </button>
      </div>
    </div>
  );
}
