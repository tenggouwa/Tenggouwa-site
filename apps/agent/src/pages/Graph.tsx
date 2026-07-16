import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../lib/api';

// 概念图谱页：以枢纽概念为入口，点开看它的邻域（中心放射布局）。
// 为什么不画全图：529 实体是「枢纽 + 长尾」+ 两个不相连的星系（ai/linux）——一次全画既卡又是团
// 看不清的毛球。邻域视图每次只画一个概念周围十几个节点，局部永远清晰。数据真相见 [[project_kb]]。

interface Hub {
  id: number;
  name: string;
  type: string;
  docs: number;
  rels: number;
}

interface GNode {
  id: number;
  name: string;
  type: string;
  series: 'ai' | 'linux' | 'other';
}

interface GEdge {
  source: number;
  target: number;
  type: string;
  description: string;
}

interface Neighborhood {
  center: number;
  nodes: GNode[];
  edges: GEdge[];
  docs: { title: string; url: string | null }[];
}

interface Landing {
  hubs: Hub[];
  stats: { entities: number; relations: number; docs_total: number; docs_graphed: number };
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
const SERIES_COLOR: Record<GNode['series'], string> = {
  ai: '#5af78e', // terminal-green
  linux: '#57c7ff', // terminal-cyan
  other: '#8b9598', // terminal-gray
};
const SERIES_LABEL: Record<GNode['series'], string> = { ai: 'ai 系列', linux: 'linux 系列', other: '散篇' };

// 放射布局：中心居中，邻居等角分布在一圈上。纯几何、无物理引擎——16 个节点足够清晰。
function layout(nb: Neighborhood, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 70;
  const others = nb.nodes.filter((n) => n.id !== nb.center);
  const pos = new Map<number, { x: number; y: number }>();
  pos.set(nb.center, { x: cx, y: cy });
  others.forEach((n, i) => {
    const a = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2;
    pos.set(n.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  return pos;
}

export default function Graph() {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [stats, setStats] = useState<Landing['stats'] | null>(null);
  const [sources, setSources] = useState<SourceOverview[] | null>(null);
  const [nb, setNb] = useState<Neighborhood | null>(null);
  const [curId, setCurId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<Landing>('/api/public/kb/graph/hubs?limit=40'),
      apiGet<SourceOverview[]>('/api/public/kb/overview'),
    ])
      .then(([land, ov]) => {
        setHubs(land.hubs);
        setStats(land.stats);
        setSources(ov);
        if (land.hubs[0]) open(land.hubs[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(id: number) {
    setCurId(id);
    setLoading(true);
    apiGet<Neighborhood>(`/api/public/kb/graph/entity/${id}`)
      .then((n) => setNb(n))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }

  const W = 640;
  const H = 460;
  const pos = useMemo(() => (nb ? layout(nb, W, H) : new Map()), [nb]);
  const centerNode = nb?.nodes.find((n) => n.id === nb.center);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>graph
        </h1>
        <p className="text-sm text-terminal-gray/70">
          站内知识的概念图谱。点左侧枢纽概念，看它跟哪些概念有什么关系、哪几篇文章讲过。
        </p>
        {(stats || sources) && (
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
            {stats && (
              <span>
                图谱：实体 <span className="text-terminal-cyan">{stats.entities}</span> · 关系{' '}
                <span className="text-terminal-cyan">{stats.relations}</span> · 已抽取{' '}
                <span className={stats.docs_graphed === stats.docs_total ? 'text-terminal-green' : 'text-terminal-yellow'}>
                  {stats.docs_graphed}/{stats.docs_total}
                </span>{' '}
                篇
              </span>
            )}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-terminal-red">加载失败：{error}</div>}
      {!hubs && !error && <div className="text-sm text-terminal-gray/50">加载中…</div>}

      {hubs && (
        <div className="flex flex-col md:flex-row gap-4 items-start">
          {/* 枢纽入口 */}
          <aside className="w-full md:w-56 shrink-0 rounded-lg border border-terminal-line/70 bg-terminal-bg/95 p-2 text-xs">
            <div className="px-1 pb-2 mb-1 border-b border-terminal-line/50 text-terminal-gray/60">
              <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">ls</span> ~/concepts
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {hubs.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => open(h.id)}
                  className={
                    'w-full flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ' +
                    (h.id === curId
                      ? 'bg-terminal-green/10 text-terminal-green'
                      : 'text-terminal-gray/80 hover:bg-terminal-line/30 hover:text-terminal-green')
                  }
                >
                  <span className="flex-1 truncate">{h.name}</span>
                  <span className="text-terminal-gray/40 shrink-0" title={`${h.docs} 篇 · ${h.rels} 关系`}>
                    {h.docs}·{h.rels}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* 图 + 详情 */}
          <div className="flex-1 min-w-0 rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
              <span className="text-[11px] ml-2 text-terminal-gray/60">
                ~/graph{centerNode ? ` · ${centerNode.name}` : ''}
              </span>
              <div className="ml-auto flex items-center gap-3 text-[11px] text-terminal-gray/50">
                {(['ai', 'linux', 'other'] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: SERIES_COLOR[s] }} />
                    {SERIES_LABEL[s]}
                  </span>
                ))}
              </div>
            </div>

            {loading && !nb ? (
              <div className="px-4 py-16 text-center text-sm text-terminal-gray/50">加载中…</div>
            ) : nb ? (
              <>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="概念邻域图">
                  {nb.edges.map((e, i) => {
                    const a = pos.get(e.source);
                    const b = pos.get(e.target);
                    if (!a || !b) return null;
                    const mx = (a.x + b.x) / 2;
                    const my = (a.y + b.y) / 2;
                    return (
                      <g key={i}>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1f2a30" strokeWidth={1} />
                        <text x={mx} y={my} fill="#5f6b6f" fontSize={9} textAnchor="middle" className="select-none">
                          {e.type}
                        </text>
                      </g>
                    );
                  })}
                  {nb.nodes.map((n) => {
                    const p = pos.get(n.id);
                    if (!p) return null;
                    const isCenter = n.id === nb.center;
                    const color = SERIES_COLOR[n.series];
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${p.x},${p.y})`}
                        onClick={() => !isCenter && open(n.id)}
                        className={isCenter ? '' : 'cursor-pointer'}
                      >
                        <circle
                          r={isCenter ? 7 : 4.5}
                          fill={isCenter ? color : 'transparent'}
                          stroke={color}
                          strokeWidth={isCenter ? 2 : 1.5}
                        />
                        <text
                          y={isCenter ? -12 : -8}
                          fill={isCenter ? color : '#c5ccce'}
                          fontSize={isCenter ? 12 : 10}
                          textAnchor="middle"
                          className="select-none font-mono"
                        >
                          {n.name}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* 中心概念详情 + 佐证文章 */}
                <div className="border-t border-terminal-line/60 px-4 py-3 text-xs space-y-2">
                  {centerNode && (
                    <div className="text-terminal-gray/70">
                      <span className="text-terminal-green">{centerNode.name}</span>
                      <span className="text-terminal-gray/40"> ({centerNode.type})</span> · 邻居 {nb.nodes.length - 1}
                      个 · 关系 {nb.edges.length} 条
                    </div>
                  )}
                  {nb.docs.length > 0 && (
                    <div className="text-terminal-gray/60">
                      出现在：
                      {nb.docs.map((d, i) => (
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
                  <div className="text-terminal-gray/40">点任意邻居节点 → 跳到它的邻域。</div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
