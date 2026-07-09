import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { parseSSEFrame } from '../lib/sse';
import AskPanel, { type AskQuestion } from '../components/AskPanel';

// agent 对话：POST /api/public/agent/chat，SSE 事件 tool / token / plan / ask / done。
// 模型自主决定是否调用 skill（如 kb_search 查知识库），再流式作答。

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface PlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface Turn {
  q: string;
  tools: ToolCall[];
  plan: PlanStep[];
  answer: string;
  ask?: AskQuestion[]; // agent 抛的选择题（ask_user skill）
  askIntro?: string;
  error?: string;
  done: boolean;
}

const SUGGESTIONS = ['这个站点的作者是谁？', '大模型推理怎么省显存？', '帮我搭一个每天抓取并推送的自动化'];

const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

const PLAN_MARK: Record<PlanStep['status'], string> = { completed: '✓', in_progress: '·', pending: ' ' };

export default function Ask() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | null>(null); // 多轮：服务端首个 event 回传，后续请求带上
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  function updateTurn(idx: number, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t, i) => (i === idx ? fn(t) : t)));
  }

  function handleEvent(raw: string, idx: number) {
    const { event, data } = parseSSEFrame(raw);
    if (!data) return;
    let obj: {
      delta?: string;
      name?: string;
      args?: Record<string, unknown>;
      message?: string;
      session_id?: string;
      plan?: PlanStep[];
      intro?: string;
      questions?: AskQuestion[];
    };
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'session') sessionId.current = obj.session_id ?? sessionId.current;
    else if (event === 'plan') updateTurn(idx, (t) => ({ ...t, plan: obj.plan ?? [] }));
    else if (event === 'ask')
      updateTurn(idx, (t) => ({ ...t, ask: obj.questions ?? [], askIntro: obj.intro || '' }));
    else if (event === 'tool')
      updateTurn(idx, (t) => ({ ...t, tools: [...t.tools, { name: obj.name ?? '', args: obj.args ?? {} }] }));
    else if (event === 'token') updateTurn(idx, (t) => ({ ...t, answer: t.answer + (obj.delta ?? '') }));
    else if (event === 'done') updateTurn(idx, (t) => ({ ...t, done: true }));
    else if (event === 'error') updateTurn(idx, (t) => ({ ...t, error: obj.message ?? '出错了', done: true }));
  }

  async function run(query: string) {
    const idx = turns.length;
    setTurns((t) => [...t, { q: query, tools: [], plan: [], answer: '', done: false }]);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, session_id: sessionId.current }),
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
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>ask
        </h1>
        <p className="text-sm text-terminal-gray/70">
          跟 agent 对话。它会自己决定要不要调用工具（比如查知识库）来回答。
        </p>
      </div>

      <div className="rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-[11px] text-terminal-gray/60 ml-2">~/ask</span>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                sessionId.current = null;
                setTurns([]);
              }}
              className="ml-auto text-[11px] text-terminal-gray/60 hover:text-terminal-green transition-colors disabled:opacity-40"
              disabled={busy}
              title="清空上下文，开一段新对话"
            >
              + 新对话
            </button>
          )}
        </div>

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
            <div key={i} className="space-y-1.5">
              <div className="text-terminal-gray">
                <span className="text-terminal-pink">~$</span> {t.q}
              </div>
              {t.plan.length > 0 && (
                <div className="my-1 pl-2 border-l border-terminal-line/60 text-xs font-mono">
                  {t.plan.map((s, si) => (
                    <div
                      key={si}
                      className={
                        s.status === 'completed'
                          ? 'text-terminal-green/70'
                          : s.status === 'in_progress'
                            ? 'text-terminal-yellow'
                            : 'text-terminal-gray/50'
                      }
                    >
                      [{PLAN_MARK[s.status]}] {s.step}
                    </div>
                  ))}
                </div>
              )}
              {t.tools.map((tc, ti) => (
                <div key={ti} className="text-xs text-terminal-green/80">
                  <span className="text-terminal-gray/50">$</span> {tc.name}
                  <span className="text-terminal-gray/60"> {fmtArgs(tc.args)}</span>
                </div>
              ))}
              {t.ask && t.ask.length > 0 && (
                <AskPanel
                  intro={t.askIntro}
                  questions={t.ask}
                  locked={i < turns.length - 1 || busy}
                  onSubmit={(text) => void run(text)}
                />
              )}
              {!t.done && t.answer === '' && !t.ask && (
                <div className="text-xs text-terminal-gray/40">
                  {t.tools.length ? '读取资料、思考中…' : '思考中…'}
                </div>
              )}
              <div className="text-sm text-terminal-gray/90">
                {renderMarkdown(t.answer)}
                {!t.done && t.answer !== '' && (
                  <span className="inline-block w-2 h-4 bg-terminal-green/80 align-text-bottom animate-blink" />
                )}
                {t.error && <span className="text-terminal-red">[错误] {t.error}</span>}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-t border-terminal-line/60">
          <span className="text-terminal-pink">~$</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={busy}
            autoFocus
            placeholder={busy ? '思考中…' : '问一个问题，回车发送'}
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

      <p className="text-xs text-terminal-gray/40">
        agent 用 DeepSeek + skills（kb_search / update_plan / web_fetch / ask_user），会记住本轮对话上下文。答案由 AI 生成，可能有误。
      </p>
    </div>
  );
}
