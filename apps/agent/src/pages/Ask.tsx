import { useEffect, useRef, useState } from 'react';
import { API_BASE, getTranscript, revokeAgent, unlockAgent } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { parseSSEFrame } from '../lib/sse';
import AskPanel, { type AskQuestion } from '../components/AskPanel';
import ApprovalCard, { type ApprovalRequest } from '../components/ApprovalCard';
import UnlockPanel from '../components/UnlockPanel';
import SessionList from '../components/SessionList';
import MemoryList from '../components/MemoryList';

// agent 对话：公开走 POST /api/public/agent/chat；私有模式（TOTP 解锁）走 /api/agent/chat + Bearer，
// 额外拿到文件读写等高危工具，write 操作触发 C2 审批卡。SSE 事件 tool/token/plan/ask/approval/done。

const TOK_KEY = 'agent_token';
const EXP_KEY = 'agent_token_exp'; // 过期时间戳(ms)，撑过刷新
const HIST_KEY = 'agent_input_history'; // 输入历史（localStorage，撑过刷新/重开）
const HIST_MAX = 100; // 历史条数上限，超出丢最旧

function loadHistory(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(-HIST_MAX) : [];
  } catch {
    return [];
  }
}

function fmtRemain(exp: number): string {
  const m = Math.max(0, Math.round((exp - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current inline-block" fill="none" strokeWidth="1.8">
    <rect x="5" y="11" width="14" height="9" rx="1.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string; // tool_call_id，用于把流式输出挂到对应工具行下
}

interface PlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface Turn {
  q: string;
  tools: ToolCall[];
  plan: PlanStep[];
  answer: string;
  ask?: AskQuestion[]; // agent 抛的选择题（ask_user skill）
  askIntro?: string;
  reasoning?: string; // 深度思考模式的思维链（reasoner），单独折叠展示，不进正文
  reflections?: { round: number; verdict: string; critique: string }[]; // 反思：历次自评
  drafts?: string[]; // 反思：被改写前的历次稿（初稿在前），过程折叠展示
  toolOutput?: Record<string, string>; // tool_call_id → 流式输出（shell_exec 实时终端）
  approval?: ApprovalRequest[]; // agent 想执行需授权的工具，等用户批/拒（C2）
  usage?: Usage;
  error?: string;
  done: boolean;
}

// 用量小字：输入/输出 token + 缓存命中率（DeepSeek 上下文缓存）。
function fmtUsage(u: Usage): string {
  const inTok = u.prompt_tokens ?? 0;
  const out = u.completion_tokens ?? 0;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? 0;
  const parts = [`输入 ${inTok}`, `输出 ${out} tok`];
  if (hit + miss > 0) parts.push(`缓存命中 ${Math.round((hit / (hit + miss)) * 100)}%`);
  return parts.join(' · ');
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
  const abortRef = useRef<AbortController | null>(null); // 切换公开/私有时中止在途流，防串通道
  const taRef = useRef<HTMLTextAreaElement>(null); // 输入框自适应高度
  const history = useRef<string[]>(loadHistory()); // 历史输入（新的在末尾），上下键翻；localStorage 持久化
  const histIdx = useRef(-1); // -1=不在翻历史（当前草稿）；0=最近一条
  const draft = useRef(''); // 进历史前暂存的草稿

  // 私有模式：TOTP 解锁换来的 agent_token（sessionStorage 撑过刷新，过期即锁）。
  const [agentToken, setAgentToken] = useState<string | null>(() => {
    const tok = sessionStorage.getItem(TOK_KEY);
    if (tok && Number(sessionStorage.getItem(EXP_KEY) || 0) > Date.now()) return tok;
    sessionStorage.removeItem(TOK_KEY);
    sessionStorage.removeItem(EXP_KEY);
    return null;
  });
  const [tokenExp, setTokenExp] = useState(() => Number(sessionStorage.getItem(EXP_KEY) || 0));
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | undefined>();
  const [autoRun, setAutoRun] = useState(false); // auto 模式：私有沙箱内自动执行、免逐条审批
  const [deepThink, setDeepThink] = useState(false); // 深度思考：换 deepseek-reasoner，显示思维链
  const [reflect, setReflect] = useState(false); // 反思：答完自评→按需改写（evaluator-optimizer）
  const [sessionRevision, setSessionRevision] = useState(0); // 新建/更新会话后刷新私有侧栏

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // 输入框随内容多行自适应高度（上限 160px 后内部滚动）
  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  }, [q]);

  // 运行中按 Esc 停止（输入框此时 disabled 收不到键，挂 document 上）
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopRun();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // token 到期自动锁定
  useEffect(() => {
    if (!agentToken) return;
    const ms = tokenExp - Date.now();
    if (ms <= 0) {
      lock();
      return;
    }
    const timer = setTimeout(() => lock(), ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentToken, tokenExp]);

  function lock(opts?: { reset?: boolean }) {
    abortRef.current?.abort(); // 中止在途私有流，别让它的 session 串到公开通道
    sessionStorage.removeItem(TOK_KEY);
    sessionStorage.removeItem(EXP_KEY);
    setAgentToken(null);
    setTokenExp(0);
    setAutoRun(false); // auto 模式每次解锁重新 opt-in，别跨会话悄悄留着
    sessionId.current = null; // 别把私有会话续到公开通道
    if (opts?.reset) setTurns([]);
  }

  async function unlock(totp: string) {
    setUnlockBusy(true);
    setUnlockError(undefined);
    try {
      const { token, ttl_seconds } = await unlockAgent(totp);
      const exp = Date.now() + ttl_seconds * 1000;
      sessionStorage.setItem(TOK_KEY, token);
      sessionStorage.setItem(EXP_KEY, String(exp));
      setAgentToken(token);
      setTokenExp(exp);
      setShowUnlock(false);
      abortRef.current?.abort(); // 中止在途公开流，切私有前清干净
      sessionId.current = null; // 进私有模式开一段新会话（工具集不同）
      setTurns([]);
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : '解锁失败');
    } finally {
      setUnlockBusy(false);
    }
  }

  // 注销全部会话：服务端吊销该账号所有 agent_token，本地随即锁回公开（best-effort，失败也锁本地）。
  async function revokeAll() {
    const tok = agentToken;
    if (!tok || busy) return;
    try {
      await revokeAgent(tok);
    } catch {
      /* 服务端注销失败也把本地锁掉：本机不再持有可用 token */
    } finally {
      lock({ reset: true });
    }
  }

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
      id?: string;
      message?: string;
      session_id?: string;
      plan?: PlanStep[];
      intro?: string;
      questions?: AskQuestion[];
      requests?: ApprovalRequest[];
      round?: number; // reflect 事件
      verdict?: string;
      critique?: string;
    } & Usage;
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'session') {
      const next = obj.session_id ?? sessionId.current;
      if (next !== sessionId.current) setSessionRevision((v) => v + 1);
      sessionId.current = next;
    }
    else if (event === 'usage') updateTurn(idx, (t) => ({ ...t, usage: obj }));
    else if (event === 'plan') updateTurn(idx, (t) => ({ ...t, plan: obj.plan ?? [] }));
    else if (event === 'approval') updateTurn(idx, (t) => ({ ...t, approval: obj.requests ?? [] }));
    else if (event === 'ask')
      updateTurn(idx, (t) => ({ ...t, ask: obj.questions ?? [], askIntro: obj.intro || '' }));
    else if (event === 'tool')
      updateTurn(idx, (t) => ({
        ...t,
        tools: [...t.tools, { name: obj.name ?? '', args: obj.args ?? {}, id: obj.id }],
      }));
    else if (event === 'tool_output')
      updateTurn(idx, (t) => {
        const id = obj.id ?? '';
        return { ...t, toolOutput: { ...t.toolOutput, [id]: (t.toolOutput?.[id] ?? '') + (obj.delta ?? '') } };
      });
    else if (event === 'reasoning')
      updateTurn(idx, (t) => ({ ...t, reasoning: (t.reasoning ?? '') + (obj.delta ?? '') }));
    else if (event === 'reflect')
      updateTurn(idx, (t) => {
        const reflections = [
          ...(t.reflections ?? []),
          { round: obj.round as number, verdict: obj.verdict as string, critique: obj.critique as string },
        ];
        // 需改写：把当前稿收进 drafts、清空 answer，让随后的改写 token 成为新答案
        if (obj.verdict === 'revise') return { ...t, reflections, drafts: [...(t.drafts ?? []), t.answer], answer: '' };
        return { ...t, reflections };
      });
    else if (event === 'token') updateTurn(idx, (t) => ({ ...t, answer: t.answer + (obj.delta ?? '') }));
    else if (event === 'done') {
      updateTurn(idx, (t) => ({ ...t, done: true }));
      if (agentToken) setSessionRevision((v) => v + 1);
    }
    else if (event === 'error') updateTurn(idx, (t) => ({ ...t, error: obj.message ?? '出错了', done: true }));
  }

  // 把一次 SSE 流回填到第 idx 轮：既用于新提问，也用于审批续跑（body 换成 { approvals }）。
  async function stream(idx: number, body: Record<string, unknown>) {
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (agentToken) headers.Authorization = `Bearer ${agentToken}`;
      const endpoint = agentToken ? '/api/agent/chat' : '/api/public/agent/chat';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...body,
          session_id: sessionId.current,
          auto_approve: !!(agentToken && autoRun),
          deep_think: deepThink,
          reflect,
        }),
        credentials: 'include',
        signal: ac.signal,
      });
      if (res.status === 401 && agentToken) {
        lock(); // 私有 token 过期/失效 → 退回公开，提示重新解锁
        throw new Error('私有会话已过期，请重新解锁私有模式');
      }
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
      if (ac.signal.aborted) return; // 切换模式主动中止，静默（对应 turn 已被重置）
      updateTurn(idx, (t) => ({ ...t, error: err instanceof Error ? err.message : '请求失败' }));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
      if (!ac.signal.aborted) updateTurn(idx, (t) => ({ ...t, done: true })); // 中止的 turn 已被重置，别再动
    }
  }

  async function run(query: string) {
    const idx = turns.length;
    setTurns((t) => [...t, { q: query, tools: [], plan: [], answer: '', done: false }]);
    await stream(idx, { q: query });
  }

  // 点开历史会话：拉 transcript 重建成 turns 回填、把 sessionId 指向它，之后照常续聊。
  async function loadSession(sid: string) {
    if (busy || !agentToken) return;
    abortRef.current?.abort();
    try {
      const t = await getTranscript(agentToken, sid);
      sessionId.current = sid;
      setTurns(
        t.turns.map((turn) => ({
          q: turn.q,
          tools: turn.tools.map((tc) => ({ name: tc.name, args: tc.args })),
          plan: [],
          answer: turn.answer,
          done: true,
        })),
      );
    } catch {
      /* 拉取失败：保持当前上下文不动 */
    }
  }

  // 审批决策回后端续跑：清掉本轮审批卡、置回"进行中"，续跑事件（工具执行 + 后续作答）回填同一轮。
  function resume(idx: number, approvals: Record<string, boolean>) {
    updateTurn(idx, (t) => ({ ...t, approval: undefined, done: false }));
    void stream(idx, { approvals });
  }

  function trySend() {
    const query = q.trim();
    if (!query || busy || unlockBusy) return; // 解锁在途别抢跑（否则会以公开身份发出）
    if (history.current[history.current.length - 1] !== query) {
      history.current.push(query);
      if (history.current.length > HIST_MAX) history.current = history.current.slice(-HIST_MAX);
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(history.current));
      } catch {
        /* 隐私模式 / 配额满：历史不持久化也不影响本次会话 */
      }
    }
    histIdx.current = -1;
    draft.current = '';
    setQ('');
    void run(query);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    trySend();
  }

  // Esc：停止当前运行（中止在途流；Pi 上已派发的命令会在后台跑完但结果被丢弃）。
  function stopRun() {
    if (!busy) return;
    abortRef.current?.abort();
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 && !t.done ? { ...t, done: true } : t)));
  }

  // 上下键翻历史输入：仅当光标在首行（↑）/末行（↓）时接管，多行编辑不受影响。
  function navHistory(dir: 1 | -1): boolean {
    const h = history.current;
    if (dir === 1) {
      // 更早
      if (histIdx.current === -1) draft.current = q;
      if (histIdx.current + 1 >= h.length) return h.length > 0; // 到底了但仍接管（别让光标乱跳）
      histIdx.current += 1;
    } else {
      if (histIdx.current < 0) return false; // 不在历史里 → 交回默认行为
      histIdx.current -= 1;
    }
    setQ(histIdx.current === -1 ? draft.current : h[h.length - 1 - histIdx.current]);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }
    return true;
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

      <div className="relative">
        {/* 私有模式常驻侧栏：会话 + 记忆。绝对定位进左侧留白，不占聊天区宽度；窄屏无留白则收起 */}
        {agentToken && (
          <aside className="hidden min-[1360px]:flex flex-col gap-3 absolute top-0 right-full mr-4 w-52 z-10">
            <SessionList
              token={agentToken}
              currentId={sessionId.current}
              onOpen={loadSession}
              busy={busy}
              refreshKey={sessionRevision}
            />
            <MemoryList token={agentToken} />
          </aside>
        )}

        <div className="rounded-lg border border-terminal-green/40 bg-terminal-bg/95 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/60">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className={`text-[11px] ml-2 ${agentToken ? 'text-terminal-green' : 'text-terminal-gray/60'}`}>
            ~/ask{agentToken ? ' (private)' : ''}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDeepThink((v) => !v)}
              className={
                'text-[11px] transition-colors ' +
                (deepThink ? 'text-terminal-cyan' : 'text-terminal-gray/60 hover:text-terminal-cyan')
              }
              title={deepThink ? '深度思考已开（deepseek-reasoner，更慢但更缜密）' : '开启深度思考：换推理模型、显示思维链'}
            >
              {deepThink ? '◆ 深度思考' : '◇ 深度思考'}
            </button>
            <button
              type="button"
              onClick={() => setReflect((v) => !v)}
              className={
                'text-[11px] transition-colors ' +
                (reflect ? 'text-terminal-yellow' : 'text-terminal-gray/60 hover:text-terminal-yellow')
              }
              title={reflect ? '反思已开：答完自评→按需改写（更慢、多花 token）' : '开启反思：答完让评审者打分、不过关就改写一版'}
            >
              {reflect ? '◆ 反思' : '◇ 反思'}
            </button>
            {agentToken ? (
              <>
                <span className="text-[11px] text-terminal-green flex items-center gap-1" title="私有模式已解锁">
                  <span className="w-1.5 h-1.5 rounded-full bg-terminal-green" />私有 · 剩 {fmtRemain(tokenExp)}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoRun((v) => !v)}
                  className={
                    'text-[11px] transition-colors ' +
                    (autoRun ? 'text-terminal-yellow' : 'text-terminal-gray/60 hover:text-terminal-yellow')
                  }
                  title={autoRun ? '沙箱内自动执行，免逐条审批（点击关闭）' : '开启后沙箱命令自动执行、不再逐条弹审批'}
                >
                  {autoRun ? '● 自动执行' : '○ 自动执行'}
                </button>
                <button
                  type="button"
                  onClick={() => !busy && lock({ reset: true })}
                  disabled={busy}
                  className="text-[11px] text-terminal-gray/60 hover:text-terminal-yellow transition-colors disabled:opacity-40"
                  title="仅本机退出私有模式（token 仍有效，可在别处继续用）"
                >
                  锁定
                </button>
                <button
                  type="button"
                  onClick={() => void revokeAll()}
                  disabled={busy}
                  className="text-[11px] text-terminal-gray/60 hover:text-terminal-red transition-colors disabled:opacity-40"
                  title="服务端吊销该账号所有 agent 会话（含本机），需重新 TOTP 解锁"
                >
                  注销全部
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowUnlock((v) => !v)}
                className="text-[11px] text-terminal-yellow/80 hover:text-terminal-yellow transition-colors flex items-center gap-1"
                title="TOTP 解锁私有模式（文件读写等高危工具）"
              >
                <LockIcon /> 私有
              </button>
            )}
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  sessionId.current = null;
                  setTurns([]);
                }}
                className="text-[11px] text-terminal-gray/60 hover:text-terminal-green transition-colors disabled:opacity-40"
                disabled={busy}
                title="清空上下文，开一段新对话"
              >
                + 新对话
              </button>
            )}
          </div>
        </div>

        {showUnlock && !agentToken && (
          <div className="px-4 pt-3">
            <UnlockPanel busy={unlockBusy} error={unlockError} onSubmit={unlock} />
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-5 text-sm">
          {turns.length === 0 && (
            <div className="text-terminal-gray/60 space-y-2">
              <div>试试问：</div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => !busy && !unlockBusy && void run(s)}
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
                <div key={ti} className="space-y-1">
                  <div className="text-xs text-terminal-green/80">
                    <span className="text-terminal-gray/50">$</span> {tc.name}
                    <span className="text-terminal-gray/60"> {fmtArgs(tc.args)}</span>
                  </div>
                  {tc.id && t.toolOutput?.[tc.id] && (
                    <pre className="max-h-48 overflow-auto rounded border border-terminal-line/60 bg-terminal-bg/80 px-2 py-1 text-[11px] leading-5 text-terminal-gray/80 whitespace-pre-wrap break-all">
                      {t.toolOutput[tc.id]}
                    </pre>
                  )}
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
              {t.approval && t.approval.length > 0 && (
                <ApprovalCard
                  key={t.approval.map((r) => r.id).join(',')}
                  requests={t.approval}
                  locked={i < turns.length - 1 || busy}
                  onDecide={(approvals) => resume(i, approvals)}
                />
              )}
              {t.reasoning && (
                <details className="text-xs" open={!t.answer}>
                  <summary className="cursor-pointer select-none text-terminal-gray/50 hover:text-terminal-cyan">
                    <span className="text-terminal-pink">~</span> 思考过程
                    {!t.done && !t.answer && <span className="text-terminal-gray/40"> · 推理中…</span>}
                  </summary>
                  <div className="mt-1 pl-2 border-l border-terminal-line/50 whitespace-pre-wrap leading-5 text-terminal-gray/45">
                    {t.reasoning}
                  </div>
                </details>
              )}
              {((t.reflections && t.reflections.length > 0) || (t.drafts && t.drafts.length > 0)) && (
                <details className="text-xs">
                  <summary className="cursor-pointer select-none text-terminal-yellow/70 hover:text-terminal-yellow">
                    🔍 反思过程{t.reflections && t.reflections.length > 0 && ` · ${t.reflections.length} 轮自评`}
                  </summary>
                  <div className="mt-1 pl-2 border-l border-terminal-yellow/30 space-y-2">
                    {t.drafts?.map((d, di) => (
                      <div key={`d${di}`}>
                        <div className="text-terminal-gray/40">初稿 {di + 1}</div>
                        <div className="whitespace-pre-wrap leading-5 text-terminal-gray/45">{d}</div>
                      </div>
                    ))}
                    {t.reflections?.map((r) => (
                      <div key={`r${r.round}`}>
                        <div className={r.verdict === 'pass' ? 'text-terminal-green/70' : 'text-terminal-yellow/70'}>
                          评审 {r.round} · {r.verdict === 'pass' ? '通过' : '需改进'}
                        </div>
                        <div className="whitespace-pre-wrap leading-5 text-terminal-gray/45">{r.critique}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {!t.done && t.answer === '' && !t.reasoning && !t.ask && !t.approval && (
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
              {t.usage && <div className="text-[11px] text-terminal-gray/40">≈ {fmtUsage(t.usage)}</div>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="flex items-start gap-2 px-4 py-3 border-t border-terminal-line/60">
          <span className="text-terminal-pink pt-0.5">~$</span>
          <textarea
            ref={taRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              const ta = e.currentTarget;
              // 回车发送，Shift+Enter 换行；输入法组词中的回车不发送
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                trySend();
              } else if (e.key === 'ArrowUp' && ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1) {
                if (navHistory(1)) e.preventDefault(); // 光标在首行 → 翻上一条历史
              } else if (e.key === 'ArrowDown' && ta.value.slice(ta.selectionStart).indexOf('\n') === -1) {
                if (navHistory(-1)) e.preventDefault(); // 光标在末行 → 翻下一条历史
              }
            }}
            disabled={busy || unlockBusy}
            autoFocus
            rows={1}
            placeholder={
              busy
                ? '运行中…（Esc 停止）'
                : (agentToken ? '私有模式 · ' : '') + '回车发送 · Shift+Enter 换行 · ↑↓ 翻历史'
            }
            className="flex-1 resize-none bg-transparent outline-none leading-6 max-h-40 text-terminal-gray placeholder:text-terminal-gray/40 disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={stopRun}
              className="text-xs text-terminal-red border border-terminal-red/40 rounded px-2 py-0.5 mt-0.5 hover:bg-terminal-red/10 transition-colors"
              title="停止当前运行（Esc）"
            >
              ■ 停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={unlockBusy || !q.trim()}
              className="text-xs text-terminal-green border border-terminal-green/40 rounded px-2 py-0.5 mt-0.5 hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
            >
              ↵
            </button>
          )}
        </form>
        </div>
      </div>

      <p className="text-xs text-terminal-gray/40">
        agent 用 DeepSeek + skills（kb_search / update_plan / web_fetch / ask_user），会记住本轮对话上下文。答案由 AI 生成，可能有误。
        {agentToken && ' 私有模式额外可用 file_list / file_read / file_write / file_edit / shell_exec / git（写操作需审批）。'}
      </p>
    </div>
  );
}
