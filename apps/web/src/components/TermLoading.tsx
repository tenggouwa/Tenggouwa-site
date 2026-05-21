import { useEffect, useState } from 'react';
import clsx from 'clsx';

// 经典 node CLI 10 帧 Braille spinner（cli-spinners "dots"）
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

interface Props {
  /** 状态文案，默认 `loading...`。多条会顺序滚动。 */
  tip?: string | string[];
  /** 卡片样式还是裸样式。卡片：居中 panel；裸：inline 一个 spinner+文本 */
  variant?: 'card' | 'inline';
  className?: string;
}

export default function TermLoading({
  tip = 'loading...',
  variant = 'card',
  className,
}: Props) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, []);

  // 多条 tip 时按 ~1.5s 切一行，营造"任务清单依次跑"的感觉
  const tips = Array.isArray(tip) ? tip : [tip];
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    if (tips.length <= 1) return;
    const id = setInterval(() => setTipIdx((i) => (i + 1) % tips.length), 1500);
    return () => clearInterval(id);
  }, [tips.length]);

  const inner = (
    <>
      <span className="text-terminal-green text-lg tabular-nums leading-none">
        {FRAMES[frame]}
      </span>
      <span className="text-sm text-terminal-gray">{tips[tipIdx]}</span>
    </>
  );

  if (variant === 'inline') {
    return (
      <span className={clsx('inline-flex items-center gap-2', className)}>{inner}</span>
    );
  }

  return (
    <div className={clsx('my-12 flex justify-center', className)}>
      <div className="border border-terminal-line/70 bg-terminal-panel/40 rounded-lg px-5 py-3 inline-flex items-center gap-3 shadow-glow">
        {inner}
      </div>
    </div>
  );
}
