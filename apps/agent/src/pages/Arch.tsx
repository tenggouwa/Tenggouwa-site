import { useEffect, useState } from 'react';
import { ARCH, type ArchNode, type Layer } from '../lib/arch';
import { renderMarkdown } from '../lib/markdown';

// Agent 架构解剖器：原地下钻。点节点 = 钻进它 → 顶部它的概念/我的实现 + 下面它的二级架构
// （和一层一样的方块图，可继续点）。面包屑回退。骨架用通用 taxonomy，血肉是本站真实实现（代码直达 GitHub）。

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

// 顶层节点 id → 层色（下钻后二级节点沿用其顶层的层色，保持一条视觉线索）。
const TOP_COLOR: Record<string, string> = {};
for (const row of ARCH) for (const n of row.nodes) TOP_COLOR[n.id] = LAYER_COLOR[row.layer];

function NodeBox({ node, color, onClick }: { node: ArchNode; color: string; onClick: () => void }) {
  const drillable = !!node.children?.length;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderColor: node.core ? color : undefined }}
      className={
        'group text-left rounded-lg border bg-terminal-bg/95 px-3 py-2 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)] ' +
        (node.core
          ? 'border-2 shadow-[0_0_12px_rgba(90,247,142,0.12)]'
          : 'border-terminal-line/70 hover:border-terminal-gray/60')
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm flex-1 truncate" style={{ color }}>
          {node.title}
        </span>
        <span className="text-terminal-gray/40 text-xs shrink-0 group-hover:text-terminal-green transition-colors">
          {drillable ? '▸' : '＋'}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-terminal-gray/50 truncate">{node.tag ?? node.summary}</div>
    </button>
  );
}

function Section({ title, color, children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs" style={{ color: color ?? '#5af78e' }}>
        <span className="text-terminal-pink">$</span> {title}
      </div>
      <div className="text-sm text-terminal-gray/85 leading-relaxed [&_a]:text-terminal-cyan [&_a]:underline [&_a]:decoration-dotted [&_code]:text-terminal-yellow">
        {children}
      </div>
    </div>
  );
}

export default function Arch() {
  const [path, setPath] = useState<ArchNode[]>([]); // 下钻路径；空 = 根总图
  const cur = path[path.length - 1] ?? null;
  const curColor = cur ? TOP_COLOR[path[0].id] : '#5af78e';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPath((p) => p.slice(0, -1));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const push = (n: ArchNode) => setPath((p) => [...p, n]);

  return (
    <div className="space-y-5">
      {/* 展开动画：视图切换时淡入 + 轻微放大，做出"钻进去"的感觉 */}
      <style>{`@keyframes archIn{from{opacity:0;transform:scale(.98) translateY(6px)}to{opacity:1;transform:none}}`}</style>

      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>arch
        </h1>
        <p className="text-sm text-terminal-gray/70">
          这套 agent 的可下钻架构图。点任意模块钻进去，看它的概念（含 2026 最新做法）、我怎么实现的，和它的二级架构——
          每一层都是同样的方块图，一直点到底，代码链接直达真实现。
        </p>
      </div>

      {/* 面包屑 */}
      <div className="flex items-center gap-1 flex-wrap text-xs text-terminal-gray/60 border-b border-terminal-line/40 pb-2">
        <span className="text-terminal-pink">~$</span>
        <button type="button" onClick={() => setPath([])} className={path.length ? 'hover:text-terminal-green' : 'text-terminal-green'}>
          ~/arch
        </button>
        {path.map((n, i) => (
          <span key={n.id} className="flex items-center gap-1">
            <span className="text-terminal-gray/30">/</span>
            <button
              type="button"
              onClick={() => setPath(path.slice(0, i + 1))}
              className={i === path.length - 1 ? 'text-terminal-green' : 'hover:text-terminal-green'}
            >
              {n.title}
            </button>
          </span>
        ))}
      </div>

      {/* 根：13 层总图 */}
      {!cur && (
        <div key="root" style={{ animation: 'archIn .18s ease-out' }}>
          <div className="flex flex-col items-stretch gap-0">
            {ARCH.map((row, i) => (
              <div key={row.layer}>
                {i > 0 && <div className="mx-auto w-px h-4 bg-terminal-line/50" />}
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${Math.min(row.nodes.length, 4)}, minmax(0, 1fr))` }}
                >
                  {row.nodes.map((n) => (
                    <NodeBox key={n.id} node={n} color={LAYER_COLOR[row.layer]} onClick={() => push(n)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-terminal-gray/40">
            <span className="text-terminal-green">▸</span> 有二级架构可钻 · <span className="text-terminal-gray/50">＋</span> 到底了（只有说明）。
            绿=循环/工具/记忆/安全 · 青=上下文/知识 · 橙=编排 · 紫=推理 · 黄=可观测。
          </p>
        </div>
      )}

      {/* 节点视图：概念 + 我的实现 + 二级架构（方块图，和一层一样） */}
      {cur && (
        <div key={cur.id} style={{ animation: 'archIn .18s ease-out' }} className="space-y-5">
          <div className="rounded-lg border-2 bg-terminal-bg/95 px-4 py-3" style={{ borderColor: curColor }}>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: curColor }} />
              <h2 className="text-lg" style={{ color: curColor }}>
                {cur.title}
              </h2>
            </div>
            <p className="mt-1 text-sm text-terminal-gray/70">{cur.summary}</p>
            {cur.tech && cur.tech.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cur.tech.map((t) => (
                  <span key={t} className="rounded border border-terminal-line/60 px-1.5 py-0.5 text-[11px] text-terminal-gray/70">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <Section title="概念 · 最新做法" color={curColor}>
            {renderMarkdown(cur.concept)}
          </Section>

          {cur.implementation && (
            <Section title="我的实现" color={curColor}>
              {renderMarkdown(cur.implementation)}
            </Section>
          )}

          {cur.children && cur.children.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs" style={{ color: curColor }}>
                <span className="text-terminal-pink">$</span> 二级架构（点进去）
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cur.children.map((c) => (
                  <NodeBox key={c.id} node={c} color={curColor} onClick={() => push(c)} />
                ))}
              </div>
            </div>
          )}

          {cur.sources && cur.sources.length > 0 && (
            <Section title="延伸阅读" color={curColor}>
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

          <button
            type="button"
            onClick={() => setPath((p) => p.slice(0, -1))}
            className="text-xs text-terminal-gray/50 hover:text-terminal-green"
          >
            ← 返回{path.length > 1 ? ` ${path[path.length - 2].title}` : ' ~/arch'}
          </button>
        </div>
      )}
    </div>
  );
}
