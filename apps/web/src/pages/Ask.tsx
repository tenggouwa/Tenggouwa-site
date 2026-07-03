import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

// /api/public/kb/ask 走 SSE 流式；dev 空 base 由 vite 反代，prod 走 VITE_API_BASE。
const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

interface Citation {
  title: string;
  url?: string | null;
}

interface Turn {
  q: string;
  answer: string;
  citations: Citation[];
  error?: string;
  done: boolean;
}

const SUGGESTIONS = [
  '大模型怎么省显存？',
  '轮盘为什么长期必输？',
  'Linux 信号是怎么回事？',
];

export default function Ask() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  function updateTurn(idx: number, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t, i) => (i === idx ? fn(t) : t)));
  }

  function handleEvent(raw: string, idx: number) {
    let event = 'message';
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let obj: { delta?: string; citations?: Citation[]; message?: string };
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'token') updateTurn(idx, (t) => ({ ...t, answer: t.answer + (obj.delta ?? '') }));
    else if (event === 'done') updateTurn(idx, (t) => ({ ...t, citations: obj.citations ?? [], done: true }));
    else if (event === 'error') updateTurn(idx, (t) => ({ ...t, error: obj.message ?? '出错了', done: true }));
  }

  async function run(query: string) {
    const idx = turns.length;
    setTurns((t) => [...t, { q: query, answer: '', citations: [], done: false }]);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/kb/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
        credentials: 'include',
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) handleEvent(part, idx);
      }
    } catch (err) {
      updateTurn(idx, (t) => ({ ...t, error: err instanceof Error ? err.message : '请求失败' }));
    } finally {
      setBusy(false);
      updateTurn(idx, (t) => ({ ...t, done: true }));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setQ('');
    void run(query);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl font-mono">
          <span className="text-terminal-pink">$ </span>ask <span className="text-terminal-yellow">knowledge-base</span>
        </h1>
        <p className="text-sm text-terminal-gray/70 font-mono">
          问点关于本站文章的问题，答案由 AI 依据文章正文生成、附来源。资料之外的会直说不知道。
        </p>
      </div>

      <div className="rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden font-mono">
        {/* mac 风 title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-[11px] text-terminal-gray/60 ml-2">~/ask</span>
        </div>

        {/* 对话记录 */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-5 text-sm">
          {turns.length === 0 && (
            <div className="text-terminal-gray/60 space-y-2">
              <div>试试问：</div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => !busy && void run(s)}
                    className="px-2 py-1 rounded border border-terminal-line/70 text-terminal-cyan hover:border-terminal-green/60 hover:text-terminal-green transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="text-terminal-gray">
                <span className="text-terminal-pink">~$</span> {t.q}
              </div>
              <div className="whitespace-pre-wrap text-terminal-gray/90 leading-relaxed">
                {t.answer}
                {!t.done && <span className="inline-block w-2 h-4 bg-terminal-green/80 align-text-bottom animate-pulse" />}
                {t.error && <span className="text-terminal-red">[错误] {t.error}</span>}
              </div>
              {t.citations.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-terminal-gray/60">
                  <span className="text-terminal-green">$ ls sources/</span>
                  {t.citations.map((c, ci) =>
                    c.url ? (
                      <Link key={ci} to={c.url} className="text-terminal-cyan hover:text-terminal-green hover:underline">
                        {c.title}
                      </Link>
                    ) : (
                      <span key={ci}>{c.title}</span>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 输入 */}
        <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-t border-terminal-line/60">
          <span className="text-terminal-pink">~$</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={busy}
            autoFocus
            placeholder={busy ? '生成中…' : '问一个问题，回车发送'}
            className="flex-1 bg-transparent outline-none text-terminal-gray placeholder:text-terminal-gray/40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="text-xs text-terminal-green border border-terminal-green/40 rounded px-2 py-0.5 hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
          >
            ↵
          </button>
        </form>
      </div>

      <p className="text-xs text-terminal-gray/40 font-mono">
        答案由 AI 生成，可能有误；点来源核对原文。
      </p>
    </div>
  );
}
