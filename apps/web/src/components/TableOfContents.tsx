import { useEffect, useState } from 'react';

// 从 markdown 渲染后的 DOM 抓 h2/h3 生成两套 TOC：
// - 桌面 xl+：右侧 sticky 一栏
// - 移动 / 平板：右下浮动按钮 + 终端面板抽屉

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

interface Props {
  containerSelector: string;
}

export default function TableOfContents({ containerSelector }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 抓标题、注入 id
  useEffect(() => {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const els = container.querySelectorAll<HTMLElement>('h2, h3');
    const out: Heading[] = [];
    els.forEach((el) => {
      const text = el.textContent ?? '';
      if (!text.trim()) return;
      if (!el.id) el.id = slugify(text);
      out.push({
        id: el.id,
        text,
        level: el.tagName === 'H2' ? 2 : 3,
      });
    });
    setHeadings(out);
  }, [containerSelector]);

  // scroll spy
  useEffect(() => {
    if (headings.length === 0) return;
    const onScroll = () => {
      let current: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < 120) current = h.id;
        else break;
      }
      setActiveId(current ?? headings[0]?.id ?? null);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [headings]);

  // 移动端抽屉：Esc 关 + 防 body 滚动
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  if (headings.length < 2) return null;

  const jumpTo = (id: string) => {
    setMobileOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${id}`);
    });
  };

  return (
    <>
      {/* === 桌面：右侧 sticky === */}
      <aside
        className="hidden xl:block fixed top-24 right-6 w-56 max-h-[calc(100vh-8rem)] overflow-y-auto font-mono text-xs"
        aria-label="目录"
      >
        <div className="text-terminal-green mb-2 flex items-center gap-1.5">
          <span className="text-terminal-pink">~$</span>
          <span>cat toc</span>
        </div>
        <ul className="space-y-1 border-l border-terminal-line/60 pl-3">
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? 'pl-3' : ''}>
              <a
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  jumpTo(h.id);
                }}
                className={
                  'block py-0.5 leading-snug transition-colors hover:text-terminal-green ' +
                  (activeId === h.id
                    ? 'text-terminal-green border-l-2 border-terminal-green -ml-3 pl-2.5'
                    : 'text-terminal-gray/70')
                }
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      {/* === 移动 / 平板：右下浮动按钮 + 抽屉 === */}
      <div className="xl:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="打开目录"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full
                     border border-terminal-green/50 bg-terminal-bg/90 backdrop-blur
                     text-terminal-green font-mono text-xs
                     hover:bg-terminal-green/15 transition-colors"
          style={{ boxShadow: '0 0 20px rgba(90,247,142,0.3)' }}
        >
          <TocIcon />
          <span>TOC</span>
          <span className="text-terminal-gray/60">({headings.length})</span>
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center px-3 pb-3 sm:pb-0 font-mono">
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
            />
            <div
              className="relative w-full sm:max-w-md bg-terminal-bg/95 border border-terminal-green/40
                         rounded-lg overflow-hidden max-h-[80vh] flex flex-col"
              style={{ boxShadow: '0 0 30px rgba(90,247,142,0.18)' }}
            >
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60 shrink-0">
                <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <span className="w-3 h-3 rounded-full bg-[#28c840]" />
                <span className="text-[11px] text-terminal-gray/60 ml-2">~/toc</span>
              </div>
              <div className="px-4 py-2 border-b border-terminal-line/40 text-xs flex items-baseline gap-1.5 shrink-0">
                <span className="text-terminal-pink">~$</span>
                <span className="text-terminal-green">cat toc</span>
                <span className="text-terminal-gray/50 ml-auto">{headings.length} 条</span>
              </div>
              <ul className="overflow-y-auto py-2 flex-1">
                {headings.map((h) => (
                  <li key={h.id} className={h.level === 3 ? 'pl-4' : ''}>
                    <button
                      type="button"
                      onClick={() => jumpTo(h.id)}
                      className={
                        'w-full text-left px-4 py-2 block transition-colors border-l-2 appearance-none ' +
                        (activeId === h.id
                          ? 'bg-terminal-green/10 border-terminal-green text-terminal-green'
                          : 'bg-transparent border-transparent text-terminal-gray hover:bg-terminal-line/30')
                      }
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[`~!@#$%^&*()+={}\[\]|\\:;"'<>,.?/]/g, '');
}
