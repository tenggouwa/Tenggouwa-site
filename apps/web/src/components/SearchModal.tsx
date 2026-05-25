import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Tag } from '@arco-design/web-react';
import clsx from 'clsx';
import { apiGet } from '../lib/api';
import type { SearchHit, SearchResponse } from '../lib/types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// 节流的轻量 debounce
function useDebounced<T>(value: T, ms = 200): T {
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
  const debouncedQ = useDebounced(q, 180);

  // 打开时自动聚焦 + 重置
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 60);
      setActive(0);
    } else {
      setQ('');
      setResp(null);
    }
  }, [visible]);

  // 输入即搜
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

  const goHit = useCallback(
    (hit: SearchHit) => {
      onClose();
      nav(hit.url);
    },
    [nav, onClose],
  );

  // 上下键 + Enter 选择
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
        // 没结果但有 query：跳独立搜索页
        onClose();
        nav(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      mask
      maskClosable
      simple
      style={{ width: 720, maxWidth: '92vw', top: '12vh' }}
      className="tg-search-modal"
    >
      <div onKeyDown={onKeyDown} className="font-mono">
        <div className="flex items-center gap-2 border-b border-terminal-line/60 pb-3 mb-3">
          <span className="text-terminal-pink shrink-0">~$</span>
          <span className="text-terminal-green shrink-0">grep -r</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文章 / 灵感…"
            className="flex-1 bg-transparent outline-none border-none text-terminal-gray placeholder:text-terminal-gray/40"
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span className="text-terminal-gray/60 text-xs">…</span>}
        </div>

        {!q.trim() ? (
          <div className="text-xs text-terminal-gray/60 px-1 py-4">
            <div>
              <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80">↑</kbd>{' '}
              <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80">↓</kbd> 选择 ·{' '}
              <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80">Enter</kbd> 打开 ·{' '}
              <kbd className="px-1.5 py-0.5 rounded border border-terminal-line/80">Esc</kbd> 关闭
            </div>
            <div className="mt-2">支持 posts + inspirations 全文搜索 · 中文/英文/标签都行</div>
          </div>
        ) : resp == null ? null : resp.hits.length === 0 ? (
          <div className="text-sm text-terminal-gray/60 py-6 text-center">
            没有命中 <code className="text-terminal-yellow">{resp.query}</code>
          </div>
        ) : (
          <>
            <ul className="max-h-[55vh] overflow-y-auto space-y-1">
              {resp.hits.map((h, idx) => (
                <li key={`${h.type}-${h.id}`}>
                  <button
                    type="button"
                    onClick={() => goHit(h)}
                    onMouseEnter={() => setActive(idx)}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded transition-colors block',
                      idx === active
                        ? 'bg-terminal-green/15 ring-1 ring-terminal-green/40'
                        : 'hover:bg-terminal-line/40',
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <Tag color={h.type === 'post' ? 'green' : 'cyan'} size="small">
                        {h.type}
                      </Tag>
                      <span className="text-terminal-gray font-medium truncate">{h.title}</span>
                    </div>
                    <div
                      className="text-xs text-terminal-gray/70 mt-1 [&>mark]:bg-terminal-yellow/30 [&>mark]:text-terminal-yellow [&>mark]:px-0.5 [&>mark]:rounded"
                      dangerouslySetInnerHTML={{ __html: h.snippet }}
                    />
                  </button>
                </li>
              ))}
            </ul>
            <div className="text-xs text-terminal-gray/50 pt-2 mt-2 border-t border-terminal-line/40 flex justify-between">
              <span>{resp.total} 条结果 · {resp.took_ms} ms</span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  nav(`/search?q=${encodeURIComponent(q.trim())}`);
                }}
                className="text-terminal-cyan hover:underline"
              >
                查看全部 →
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
