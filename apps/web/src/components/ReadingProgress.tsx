import { useEffect, useState } from 'react';

// 顶部细绿条，跟随滚动表示阅读进度
export default function ReadingProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrolled = doc.scrollTop;
      const max = doc.scrollHeight - doc.clientHeight;
      setPct(max > 0 ? (scrolled / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[2px] bg-transparent z-[60] pointer-events-none"
      aria-hidden
    >
      <div
        className="h-full bg-terminal-green transition-[width] duration-75"
        style={{
          width: `${pct}%`,
          boxShadow: '0 0 8px rgba(90,247,142,0.6)',
        }}
      />
    </div>
  );
}
