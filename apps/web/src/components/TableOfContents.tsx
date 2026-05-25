import { useEffect, useState } from 'react';

// 从 markdown 渲染后的 DOM 抓 h2/h3 生成右侧 sticky TOC
// 桌面：右侧 sticky 一栏；移动端隐藏（避免遮挡正文）

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

interface Props {
  // markdown 渲染容器的 DOM 选择器，依赖 PostDetail 给容器加 ref / id
  containerSelector: string;
}

export default function TableOfContents({ containerSelector }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 抓标题、给每个 heading 注入 id（如果还没有）
  useEffect(() => {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const els = container.querySelectorAll<HTMLElement>('h2, h3');
    const out: Heading[] = [];
    els.forEach((el) => {
      const text = el.textContent ?? '';
      if (!text.trim()) return;
      if (!el.id) {
        el.id = slugify(text);
      }
      out.push({
        id: el.id,
        text,
        level: el.tagName === 'H2' ? 2 : 3,
      });
    });
    setHeadings(out);
  }, [containerSelector]);

  // 滚动时高亮当前章节
  useEffect(() => {
    if (headings.length === 0) return;
    const onScroll = () => {
      // 找当前"靠近视口顶部 100px 内最近的 heading"
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

  if (headings.length < 2) return null; // 太短的文章不显示 TOC

  return (
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
                document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(null, '', `#${h.id}`);
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
  );
}

// 生成 heading id（保持中文字符，url-encode 由浏览器处理）
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[`~!@#$%^&*()+={}\[\]|\\:;"'<>,.?/]/g, '');
}
