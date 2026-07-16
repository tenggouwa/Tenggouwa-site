import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { apiGet } from '../lib/api';

// 概念图谱页：力导向全图（Obsidian 同款）。529 实体 / 499 关系一次性铺开，
// 节点按系列着色、按度数定大小，能拖能缩放。数据真相（两个不相连星系）见 [[project_kb]]。

type Series = 'ai' | 'linux' | 'other';

interface GNode {
  id: number;
  name: string;
  type: string;
  docs: number;
  deg: number;
  series: Series;
}

interface GLink {
  source: number;
  target: number;
  type: string;
}

interface Full {
  nodes: GNode[];
  edges: GLink[];
  stats: { entities: number; relations: number; docs_total: number; docs_graphed: number };
}

interface Neighborhood {
  center: number;
  nodes: { id: number; name: string; type: string; series: Series }[];
  edges: { source: number; target: number; type: string; description: string }[];
  docs: { title: string; url: string | null }[];
}

interface SourceOverview {
  kind: string;
  documents: number;
  chunks: number;
  embedded: number;
  last_synced_at: string | null;
}

const fmtWhen = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

const SITE = 'https://tenggouwa.com';
const abs = (u?: string | null) => (u ? (u.startsWith('http') ? u : SITE + u) : undefined);

// 系列 → 颜色（terminal 色板）。两个星系一眼分开：ai 绿、linux 青、散篇灰。
const SERIES_COLOR: Record<Series, string> = {
  ai: '#5af78e', // terminal-green
  linux: '#57c7ff', // terminal-cyan
  other: '#8b9598', // terminal-gray
};
const SERIES_LABEL: Record<Series, string> = { ai: 'ai 系列', linux: 'linux 系列', other: '散篇' };

const radius = (deg: number) => 2 + Math.sqrt(Math.max(1, deg)) * 1.6;
const linkEnd = (v: string | number | { id?: string | number } | undefined) =>
  typeof v === 'object' ? (v?.id as number) : (v as number);

export default function Graph() {
  const [full, setFull] = useState<Full | null>(null);
  const [sources, setSources] = useState<SourceOverview[] | null>(null);
  const [detail, setDetail] = useState<Neighborhood | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fgRef = useRef<ForceGraphMethods<NodeObject<GNode>, LinkObject<GNode, GLink>>>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const fitted = useRef(false);

  useEffect(() => {
    Promise.all([
      apiGet<Full>('/api/public/kb/graph/full'),
      apiGet<SourceOverview[]>('/api/public/kb/overview'),
    ])
      .then(([f, ov]) => {
        setFull(f);
        setSources(ov);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [full]);

  // 力导向会原地改写节点对象（塞 x/y）——graphData 只在 full 变时重建，否则布局会被重置。
  const data = useMemo(
    () => ({
      nodes: full ? full.nodes.map((n) => ({ ...n })) : [],
      links: full ? full.edges.map((e) => ({ ...e })) : [],
    }),
    [full],
  );

  // 邻接表：选中一个节点时高亮它和直接邻居，其余压暗。
  const adj = useMemo(() => {
    const m = new Map<number, Set<number>>();
    full?.edges.forEach((e) => {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    });
    return m;
  }, [full]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !full) return [];
    return full.nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, full]);

  const select = useCallback((id: number) => {
    setSelId(id);
    apiGet<Neighborhood>(`/api/public/kb/graph/entity/${id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, []);

  const focus = useCallback(
    (id: number) => {
      select(id);
      const n = data.nodes.find((x) => x.id === id) as NodeObject<GNode> | undefined;
      if (n && fgRef.current && n.x != null && n.y != null) {
        fgRef.current.centerAt(n.x, n.y, 600);
        fgRef.current.zoom(4, 600);
      }
    },
    [data, select],
  );

  const paintNode = useCallback(
    (node: NodeObject<GNode>, ctx: CanvasRenderingContext2D, scale: number) => {
      const isSel = node.id === selId;
      const isNbr = selId != null && (adj.get(selId)?.has(node.id as number) ?? false);
      const dim = selId != null && !isSel && !isNbr;
      const r = radius(node.deg);
      ctx.globalAlpha = dim ? 0.12 : 1;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, isSel ? r + 1.5 : r, 0, 2 * Math.PI);
      ctx.fillStyle = SERIES_COLOR[node.series] ?? SERIES_COLOR.other;
      ctx.fill();
      if (isSel) {
        ctx.lineWidth = 1.6 / scale;
        ctx.strokeStyle = '#e6f2ef';
        ctx.stroke();
      }
      const showLabel = !dim && (isSel || isNbr || scale > 2 || node.deg >= 8);
      if (showLabel) {
        const fs = Math.max(10 / scale, 2.4);
        ctx.font = `${fs}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isSel ? SERIES_COLOR[node.series] : '#c5ccce';
        ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + r + 1);
      }
      ctx.globalAlpha = 1;
    },
    [selId, adj],
  );

  const paintPointer = useCallback((node: NodeObject<GNode>, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius(node.deg) + 2, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback(
    (l: LinkObject<GNode, GLink>) => {
      if (selId == null) return 'rgba(120,130,135,0.18)';
      return linkEnd(l.source) === selId || linkEnd(l.target) === selId
        ? 'rgba(90,247,142,0.55)'
        : 'rgba(120,130,135,0.05)';
    },
    [selId],
  );

  const detailNames = useMemo(() => {
    const m = new Map<number, string>();
    detail?.nodes.forEach((n) => m.set(n.id, n.name));
    return m;
  }, [detail]);
  const centerNode = detail?.nodes.find((n) => n.id === detail.center);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>graph
        </h1>
        <p className="text-sm text-terminal-gray/70">
          站内知识的概念图谱。拖拽移动、滚轮缩放；点任意节点看它的关系与佐证文章。
        </p>
        {(full || sources) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-terminal-gray/60 pt-1">
            {sources?.map((s) => (
              <span key={s.kind}>
                <span className="text-terminal-green">{s.kind}</span> 源：文档{' '}
                <span className="text-terminal-cyan">{s.documents}</span> · 分块{' '}
                <span className="text-terminal-cyan">{s.chunks}</span> · 已嵌入{' '}
                <span className={s.embedded === s.chunks ? 'text-terminal-green' : 'text-terminal-yellow'}>
                  {s.embedded}
                </span>
                <span className="text-terminal-gray/40"> · 同步 {fmtWhen(s.last_synced_at)}</span>
              </span>
            ))}
            {full && (
              <span>
                图谱：实体 <span className="text-terminal-cyan">{full.stats.entities}</span> · 关系{' '}
                <span className="text-terminal-cyan">{full.stats.relations}</span> · 已抽取{' '}
                <span
                  className={
                    full.stats.docs_graphed === full.stats.docs_total ? 'text-terminal-green' : 'text-terminal-yellow'
                  }
                >
                  {full.stats.docs_graphed}/{full.stats.docs_total}
                </span>{' '}
                篇
              </span>
            )}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-terminal-red">加载失败：{error}</div>}
      {!full && !error && <div className="text-sm text-terminal-gray/50">加载中…</div>}

      {full && (
        <div className="rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden">
          {/* mac 三色点 title bar + 图例 + 搜索 */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
            <span className="text-[11px] ml-2 text-terminal-gray/60">~/graph</span>
            <div className="ml-auto flex items-center gap-3 text-[11px] text-terminal-gray/50">
              {(['ai', 'linux', 'other'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: SERIES_COLOR[s] }} />
                  {SERIES_LABEL[s]}
                </span>
              ))}
            </div>
          </div>

          {/* 搜索定位 */}
          <div className="relative px-3 py-2 border-b border-terminal-line/50 bg-terminal-bg/60">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-terminal-pink">~$</span>
              <span className="text-terminal-green">grep</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="按名字定位概念…"
                className="flex-1 bg-transparent outline-none text-terminal-gray placeholder:text-terminal-gray/30"
              />
            </div>
            {matches.length > 0 && (
              <div className="absolute left-3 right-3 top-full z-10 mt-1 rounded border border-terminal-line/70 bg-terminal-panel shadow-lg">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      focus(m.id);
                      setQuery('');
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1 text-left text-xs text-terminal-gray/80 hover:bg-terminal-green/10 hover:text-terminal-green"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SERIES_COLOR[m.series] }} />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-terminal-gray/40 shrink-0">
                      {m.docs}·{m.deg}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 力导向画布 + 详情覆盖卡 */}
          <div ref={wrapRef} className="relative">
            <ForceGraph2D<GNode, GLink>
              ref={fgRef}
              graphData={data}
              width={width}
              height={560}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={3}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={paintPointer}
              nodeLabel={(n) => (n as NodeObject<GNode>).name}
              linkColor={linkColor}
              linkWidth={(l) =>
                selId != null && (linkEnd(l.source) === selId || linkEnd(l.target) === selId) ? 1.6 : 0.6
              }
              cooldownTicks={120}
              d3VelocityDecay={0.32}
              warmupTicks={24}
              onNodeClick={(n) => select(n.id as number)}
              onBackgroundClick={() => {
                setSelId(null);
                setDetail(null);
              }}
              onEngineStop={() => {
                if (!fitted.current) {
                  fitted.current = true;
                  fgRef.current?.zoomToFit(500, 48);
                }
              }}
            />

            {detail && centerNode && (
              <div className="absolute top-3 right-3 w-72 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-terminal-line/70 bg-terminal-panel/95 p-3 text-xs shadow-xl backdrop-blur-sm">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <span className="text-terminal-green text-sm">{centerNode.name}</span>
                    <span className="text-terminal-gray/40"> ({centerNode.type})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelId(null);
                      setDetail(null);
                    }}
                    className="text-terminal-gray/40 hover:text-terminal-green"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 text-terminal-gray/50">
                  邻居 {detail.nodes.length - 1} 个 · 关系 {detail.edges.length} 条
                </div>

                {detail.edges.length > 0 && (
                  <div className="mt-2 space-y-0.5 text-terminal-gray/70">
                    {detail.edges.slice(0, 12).map((e, i) => (
                      <div key={i} className="truncate">
                        <button
                          type="button"
                          onClick={() => focus(e.source === detail.center ? e.target : e.source)}
                          className="text-terminal-cyan hover:text-terminal-green"
                        >
                          {detailNames.get(e.source === detail.center ? e.target : e.source) ?? '?'}
                        </button>
                        <span className="text-terminal-gray/40"> —{e.type}→</span>
                      </div>
                    ))}
                  </div>
                )}

                {detail.docs.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-terminal-line/50 text-terminal-gray/60">
                    出现在：
                    {detail.docs.map((d, i) => (
                      <span key={i}>
                        {i > 0 && '、'}
                        {abs(d.url) ? (
                          <a
                            href={abs(d.url)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-terminal-cyan underline decoration-dotted hover:text-terminal-green"
                          >
                            《{d.title}》
                          </a>
                        ) : (
                          <span>《{d.title}》</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
