import { useEffect, useState } from 'react';
import { ARCH, type ArchNode, type Layer } from '../lib/arch';
import { renderMarkdown } from '../lib/markdown';

// Agent 架构解剖器：分层主图 → 点节点开抽屉（概念 + 我的实现 + 二级架构）→ 顺着二级往下钻。
// 骨架用业界通用 taxonomy，血肉用本站真实实现（代码链接直达 GitHub）。数据见 lib/arch.ts。

// 层 → 强调色（terminal 色板）。同色系呼应 graph 页的系列着色语言。
const LAYER_COLOR: Record<Layer, string> = {
  entry: '#8b9598',
  loop: '#5af78e',
  context: '#57c7ff',
  tools: '#5af78e',
  mcp: '#57c7ff',
  orchestration: '#f78e5a',
  planning: '#f78e5a',
  memory: '#5af78e',
  rag: '#57c7ff',
  security: '#5af78e',
  reasoning: '#c78ef7',
  observability: '#f7d65a',
  infra: '#8b9598',
};

function NodeBox({ node, color, onClick }: { node: ArchNode; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderColor: node.core ? color : undefined }}
      className={
        'group text-left rounded-lg border bg-terminal-bg/95 px-3 py-2 transition-all hover:-translate-y-0.5 ' +
        (node.core
          ? 'border-2 shadow-[0_0_12px_rgba(90,247,142,0.12)]'
          : 'border-terminal-line/70 hover:border-terminal-gray/50')
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm" style={{ color }}>
          {node.title}
        </span>
        {node.core && <span className="text-terminal-gray/40 text-xs">▸</span>}
      </div>
      {node.tag && <div className="mt-0.5 text-[11px] text-terminal-gray/50 truncate">{node.tag}</div>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-terminal-green text-xs">
        <span className="text-terminal-pink">$</span> {title}
      </div>
      <div className="text-sm text-terminal-gray/85 leading-relaxed [&_a]:text-terminal-cyan [&_a]:underline [&_a]:decoration-dotted [&_code]:text-terminal-yellow">
        {children}
      </div>
    </div>
  );
}

export default function Arch() {
  const [stack, setStack] = useState<ArchNode[]>([]); // 下钻路径；空 = 抽屉关
  const cur = stack[stack.length - 1] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setStack([]);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const colorOf = (n: ArchNode): string => {
    for (const row of ARCH) if (row.nodes.some((x) => x.id === n.id || x.children?.some((c) => c.id === n.id))) return LAYER_COLOR[row.layer];
    // 二级节点：沿用其所在顶层节点的层色
    for (const row of ARCH)
      for (const top of row.nodes) if (top.children?.some((c) => c.id === n.id)) return LAYER_COLOR[row.layer];
    return '#8b9598';
  };
  const curColor = cur ? colorOf(cur) : '#5af78e';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>arch
        </h1>
        <p className="text-sm text-terminal-gray/70">
          这套 agent 的可下钻架构解剖图。骨架是通用 agent 工程（harness engineering）的分层，血肉是本站的真实实现——
          点任意模块，看它的概念（含 2026 最新做法）、我怎么实现的、二级架构，以及直达真代码的链接。
        </p>
      </div>

      {/* 分层主图：自上而下 = 请求流 */}
      <div className="flex flex-col items-stretch gap-0">
        {ARCH.map((row, i) => (
          <div key={row.layer}>
            {i > 0 && <div className="mx-auto w-px h-4 bg-terminal-line/50" />}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(row.nodes.length, 4)}, minmax(0, 1fr))` }}>
              {row.nodes.map((n) => (
                <NodeBox key={n.id} node={n} color={LAYER_COLOR[row.layer]} onClick={() => setStack([n])} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-terminal-gray/40">
        <span className="text-terminal-green">▸</span> 标记的是核心节点（有二级架构）。绿=循环/工具/记忆/安全 · 青=上下文/知识 ·
        橙=编排 · 紫=推理 · 黄=可观测。
      </p>

      {/* 下钻抽屉 */}
      {cur && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setStack([])}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl h-full overflow-y-auto bg-terminal-bg border-l border-terminal-line/70 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* mac 三色点 + 面包屑 title bar */}
            <div className="sticky top-0 z-10 flex items-center gap-1.5 px-4 py-2.5 border-b border-terminal-line/60 bg-terminal-panel/80 backdrop-blur">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
              <div className="ml-2 text-[11px] text-terminal-gray/60 flex items-center gap-1 flex-wrap">
                <span className="text-terminal-pink">~$</span>
                <button type="button" onClick={() => setStack([])} className="hover:text-terminal-green">
                  ~/arch
                </button>
                {stack.map((n, i) => (
                  <span key={n.id} className="flex items-center gap-1">
                    <span className="text-terminal-gray/30">/</span>
                    <button
                      type="button"
                      onClick={() => setStack(stack.slice(0, i + 1))}
                      className={i === stack.length - 1 ? 'text-terminal-green' : 'hover:text-terminal-green'}
                    >
                      {n.title}
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStack([])}
                className="ml-auto text-terminal-gray/40 hover:text-terminal-green"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              <div>
                <h2 className="text-lg" style={{ color: curColor }}>
                  {cur.title}
                </h2>
                <p className="mt-1 text-sm text-terminal-gray/70">{cur.summary}</p>
              </div>

              {cur.tech && cur.tech.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cur.tech.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-terminal-line/60 px-1.5 py-0.5 text-[11px] text-terminal-gray/70"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <Section title="概念 · 最新做法">{renderMarkdown(cur.concept)}</Section>

              {cur.implementation && <Section title="我的实现">{renderMarkdown(cur.implementation)}</Section>}

              {cur.children && cur.children.length > 0 && (
                <Section title="二级架构（点进去）">
                  <div className="grid gap-2 sm:grid-cols-2 not-prose">
                    {cur.children.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setStack([...stack, c])}
                        className="text-left rounded-lg border border-terminal-line/60 bg-terminal-panel/40 px-3 py-2 hover:border-terminal-green/50 hover:bg-terminal-green/5 transition-colors"
                      >
                        <div className="text-sm text-terminal-gray/90 flex items-center gap-1">
                          {c.title} <span className="text-terminal-gray/40 text-xs">▸</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-terminal-gray/50">{c.summary}</div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {cur.sources && cur.sources.length > 0 && (
                <Section title="延伸阅读">
                  <ul className="space-y-1">
                    {cur.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
