import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

interface SourceOverview {
  kind: string;
  name: string;
  documents: number;
  chunks: number;
  embedded: number;
  last_synced_at: string | null;
}

interface DocItem {
  id: number;
  title: string;
  url?: string | null;
  chunks: number;
  updated_at: string;
}

interface DocPage {
  items: DocItem[];
  total: number;
  has_more: boolean;
}

const SITE = 'https://tenggouwa.com';
const abs = (u?: string | null) => (u ? (u.startsWith('http') ? u : SITE + u) : undefined);
const fmt = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

export default function KnowledgeBase() {
  const [overview, setOverview] = useState<SourceOverview[] | null>(null);
  const [docs, setDocs] = useState<DocPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<SourceOverview[]>('/api/public/kb/overview'),
      apiGet<DocPage>('/api/public/kb/documents?limit=100'),
    ])
      .then(([ov, dp]) => {
        setOverview(ov);
        setDocs(dp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>knowledge-base
        </h1>
        <p className="text-sm text-terminal-gray/70">
          agent 的知识来源。这里浏览知识库本身——数据源、文档、分块与嵌入情况。
        </p>
      </div>

      {error && <div className="text-sm text-terminal-red">加载失败：{error}</div>}
      {!overview && !error && <div className="text-sm text-terminal-gray/50">加载中…</div>}

      {overview && (
        <section className="grid sm:grid-cols-2 gap-4">
          {overview.map((s) => (
            <div key={s.kind} className="rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-terminal-green font-semibold">{s.name}</span>
                <span className="text-[10px] text-terminal-gray/50">最近同步 {fmt(s.last_synced_at)}</span>
              </div>
              <div className="flex gap-5 text-sm text-terminal-gray/85">
                <span>
                  文档 <span className="text-terminal-cyan">{s.documents}</span>
                </span>
                <span>
                  分块 <span className="text-terminal-cyan">{s.chunks}</span>
                </span>
                <span>
                  已嵌入{' '}
                  <span className={s.embedded === s.chunks ? 'text-terminal-green' : 'text-terminal-yellow'}>
                    {s.embedded}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {docs && (
        <section className="space-y-3">
          <h2 className="text-sm text-terminal-gray/70">
            <span className="text-terminal-pink">$ </span>ls documents/{' '}
            <span className="text-terminal-gray/50">({docs.total})</span>
          </h2>
          <ul className="divide-y divide-terminal-line/60">
            {docs.items.map((d) => (
              <li key={d.id} className="py-2.5 flex items-baseline justify-between gap-4">
                {abs(d.url) ? (
                  <a
                    href={abs(d.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-terminal-gray hover:text-terminal-green transition-colors truncate"
                  >
                    {d.title}
                  </a>
                ) : (
                  <span className="text-sm text-terminal-gray truncate">{d.title}</span>
                )}
                <span className="text-xs text-terminal-gray/50 shrink-0">
                  {d.chunks} 块 · {fmt(d.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
