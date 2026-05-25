import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Tag, Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import { getSeries } from '../lib/series';
import type { PostListPage, PostSummary } from '../lib/types';

export default function Series() {
  const { tag } = useParams<{ tag: string }>();
  const meta = tag ? getSeries(tag) : null;
  const [items, setItems] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tag) return;
    setItems(null);
    apiGet<PostListPage>(`/api/public/posts?tag=${encodeURIComponent(tag)}&limit=100`)
      .then((page) => {
        // 系列按发布顺序（升序）展示，让"第 1 篇"在最上
        const sorted = [...page.items].sort((a, b) =>
          a.published_at.localeCompare(b.published_at),
        );
        setItems(sorted);
      })
      .catch((e: Error) => setError(e.message));
  }, [tag]);

  if (!tag || !meta) {
    return (
      <Empty
        description={
          <div className="text-terminal-gray/70">
            未知系列：<code>{tag}</code>
          </div>
        }
      />
    );
  }

  if (error) {
    return (
      <div className="text-red-400">
        <span className="text-terminal-pink">err: </span>
        {error}
      </div>
    );
  }

  if (items == null) {
    return <TermLoading tip={['fetching series...', 'sorting episodes...']} />;
  }

  return (
    <div className="space-y-6">
      {/* 系列封面：终端面板风 */}
      <div
        className="rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden"
        style={{ boxShadow: '0 0 30px rgba(90,247,142,0.15)' }}
      >
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-[11px] text-terminal-gray/60 ml-2 font-mono">
            ~/series/{meta.tag}
          </span>
        </div>
        <div className="p-6 font-mono space-y-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-terminal-pink shrink-0">~$</span>
            <span className="text-terminal-green">{meta.command_hint ?? `cat ${meta.tag}/README`}</span>
          </div>
          <h1 className="text-2xl text-terminal-green">{meta.title}</h1>
          <p className="text-terminal-gray/85 leading-relaxed">{meta.description}</p>
          <div className="text-xs text-terminal-gray/60 pt-2">
            共 <span className="text-terminal-green">{items.length}</span> 篇 · 已发布{' '}
            <span className="text-terminal-green">
              {items.filter((p) => new Date(p.published_at) <= new Date()).length}
            </span>{' '}
            篇
          </div>
        </div>
      </div>

      {/* 目录 */}
      <h2 className="text-terminal-green text-lg flex items-baseline gap-2">
        <span className="text-terminal-pink">$</span>
        <span>ls -la</span>
      </h2>
      {items.length === 0 ? (
        <Empty description="系列里还没有已发布的文章" />
      ) : (
        <ol className="space-y-2 font-mono">
          {items.map((p, idx) => (
            <li key={p.id}>
              <Link
                to={`/posts/${p.slug}`}
                className="group flex items-baseline gap-3 px-3 py-2 rounded
                           border border-terminal-line/40
                           hover:border-terminal-green/50 hover:bg-terminal-green/5
                           transition-all"
              >
                <span className="text-terminal-gray/50 text-xs tabular-nums shrink-0 w-8">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-terminal-gray group-hover:text-terminal-green transition-colors truncate">
                      {p.title}
                    </span>
                    <span className="text-xs text-terminal-gray/50 shrink-0">
                      {p.published_at.slice(0, 10)}
                    </span>
                  </div>
                  {p.summary && (
                    <p className="text-xs text-terminal-gray/65 mt-1 line-clamp-1">{p.summary}</p>
                  )}
                  <div className="mt-1 flex gap-1.5 flex-wrap">
                    {p.tags
                      .filter((t) => t !== meta.tag)
                      .slice(0, 4)
                      .map((t) => (
                        <Tag key={t} color="green" size="small">
                          {t}
                        </Tag>
                      ))}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
