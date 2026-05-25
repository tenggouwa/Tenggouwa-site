import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { apiGet } from '../lib/api';
import type { SearchHit, SearchResponse } from '../lib/types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function SearchModal({ visible, onClose }: Props) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const debouncedQ = useDebounced(q, 180);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setActive(0);
      document.body.style.overflow = 'hidden';
    } else {
      setQ('');
      setResp(null);
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [visible]);

  useEffect(() => {
    const term = debouncedQ.trim();
    if (!term) {
      setResp(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiGet<SearchResponse>(`/api/public/search?q=${encodeURIComponent(term)}&limit=20`)
      .then((data) => {
        if (!cancelled) {
          setResp(data);
          setActive(0);
        }
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
  }, [debouncedQ]);

  // 选中项滚到可视区
  useEffect(() => {
    if (!panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(`[data-hit-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const goHit = useCallback(
    (hit: SearchHit) => {
      onClose();
      nav(hit.url);
    },
    [nav, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const hits = resp?.hits ?? [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit) goHit(hit);
      else if (q.trim()) {
        onClose();
        nav(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 font-mono">
      {/* backdrop */}
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-default"
      />
      {/* panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-[640px] bg-terminal-bg/95 border border-terminal-green/40 rounded-lg overflow-hidden"
        style={{ boxShadow: '0 0 40px rgba(90,247,142,0.18), 0 8px 32px rgba(0,0,0,0.6)' }}
        onKeyDown={onKeyDown}
      >
        {/* mac 风 title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-[11px] text-terminal-gray/60 ml-2">~/search</span>
        </div>

        {/* input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-terminal-line/40">
          <span className="text-terminal-pink shrink-0">~$</span>
          <span className="text-terminal-green shrink-0">grep -r</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文章 / 灵感…"
            className="flex-1 bg-transparent outline-none border-none text-terminal-gray placeholder:text-terminal-gray/40 caret-terminal-green"
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span className="text-terminal-gray/50 text-xs animate-pulse">...</span>}
        </div>

        {/* body */}
        <div className="max-h-[55vh] overflow-y-auto">
          {!q.trim() ? (
            <div className="px-5 py-6 text-xs text-terminal-gray/60 leading-relaxed">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  <span>选择</span>
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>Enter</Kbd>
                  <span>打开</span>
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>Esc</Kbd>
                  <span>关闭</span>
                </span>
              </div>
              <div className="mt-3 text-terminal-gray/50">
                支持 posts + inspirations 全文搜索 · 中文 / 英文 / 标签
              </div>
            </div>
          ) : resp == null ? null : resp.hits.length === 0 ? (
            <div className="px-5 py-8 text-sm text-terminal-gray/60 text-center">
              <span className="text-terminal-pink">$ </span>
              no match for <span className="text-terminal-yellow">{resp.query}</span>
            </div>
          ) : (
            <ul className="py-2">
              {resp.hits.map((h, idx) => (
                <li key={`${h.type}-${h.id}`}>
                  <button
                    type="button"
                    data-hit-idx={idx}
                    onClick={() => goHit(h)}
                    onMouseEnter={() => setActive(idx)}
                    className={clsx(
                      'w-full text-left px-4 py-2.5 block transition-colors border-l-2',
                      idx === active
                        ? 'bg-terminal-green/10 border-terminal-green'
                        : 'border-transparent hover:bg-terminal-line/30',
                    )}
                  >
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span
                        className={clsx(
                          'text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0',
                          h.type === 'post'
                            ? 'text-terminal-green bg-terminal-green/15'
                            : 'text-terminal-cyan bg-terminal-cyan/15',
                        )}
                      >
                        {h.type}
                      </span>
                      <span className="text-terminal-gray font-medium truncate">{h.title}</span>
                    </div>
                    <div
                      className="text-xs text-terminal-gray/65 mt-1 line-clamp-2 [&>mark]:bg-terminal-yellow/30 [&>mark]:text-terminal-yellow [&>mark]:px-0.5 [&>mark]:rounded"
                      dangerouslySetInnerHTML={{ __html: h.snippet }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* footer */}
        {resp != null && resp.hits.length > 0 && (
          <div className="px-4 py-2 text-[11px] text-terminal-gray/50 border-t border-terminal-line/40 flex justify-between items-center">
            <span>
              {resp.total} hits · {resp.took_ms} ms
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                nav(`/search?q=${encodeURIComponent(q.trim())}`);
              }}
              className="text-terminal-cyan hover:text-terminal-green hover:underline"
            >
              查看全部 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80 bg-terminal-panel/60 text-terminal-gray/80 text-[10px] font-mono">
      {children}
    </kbd>
  );
}
