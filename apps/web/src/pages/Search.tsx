import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tag, Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import type { SearchResponse } from '../lib/types';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // URL ?q= 变化时拉数据
  useEffect(() => {
    setInput(q);
    const term = q.trim();
    if (!term) {
      setResp(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiGet<SearchResponse>(`/api/public/search?q=${encodeURIComponent(term)}&limit=50`)
      .then((d) => {
        if (!cancelled) setResp(d);
      })
      .catch(() => {
        if (!cancelled) setResp({ query: term, took_ms: 0, total: 0, hits: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = input.trim();
    if (!term) return;
    setParams({ q: term });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-terminal-green text-2xl">
        <span className="text-terminal-pink">$ </span>grep -r <span className="text-terminal-yellow">{q || '<keyword>'}</span> .
      </h1>

      <form onSubmit={submit} className="flex items-center gap-2 border-b border-terminal-line/60 pb-3">
        <span className="text-terminal-pink shrink-0">~$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入关键词后回车搜索…"
          className="flex-1 bg-transparent outline-none text-terminal-gray placeholder:text-terminal-gray/40"
          autoFocus
          spellCheck={false}
        />
      </form>

      {!q ? (
        <Empty description={
          <div className="text-sm text-terminal-gray/70">
            键入关键词搜索文章和灵感。也可以全站任意页面按{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80 text-xs">⌘</kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80 text-xs">K</kbd>{' '}
            召唤搜索框。
          </div>
        } />
      ) : loading || resp == null ? (
        <TermLoading tip={['searching...', 'matching trigrams...', 'ranking...']} />
      ) : resp.hits.length === 0 ? (
        <Empty description={`没有命中 "${resp.query}"`} />
      ) : (
        <>
          <div className="text-xs text-terminal-gray/60">
            {resp.total} 条结果 · 用时 {resp.took_ms} ms
          </div>
          <ul className="divide-y divide-terminal-line/60">
            {resp.hits.map((h) => (
              <li key={`${h.type}-${h.id}`} className="py-4">
                <Link to={h.url} className="group block">
                  <div className="flex items-baseline gap-2">
                    <Tag color={h.type === 'post' ? 'green' : 'cyan'} size="small">
                      {h.type}
                    </Tag>
                    <h2 className="text-lg text-terminal-gray group-hover:text-terminal-green transition-colors">
                      {h.title}
                    </h2>
                    {h.timestamp && (
                      <span className="text-xs text-terminal-gray/60 shrink-0 ml-auto">
                        {h.timestamp.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-sm text-terminal-gray/80 mt-2 [&>mark]:bg-terminal-yellow/30 [&>mark]:text-terminal-yellow [&>mark]:px-0.5 [&>mark]:rounded"
                    dangerouslySetInnerHTML={{ __html: h.snippet }}
                  />
                  {h.tags.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {h.tags.map((t) => (
                        <Tag key={t} color="green" size="small">
                          {t}
                        </Tag>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
