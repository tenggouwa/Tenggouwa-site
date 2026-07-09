import { useState } from 'react';

export interface ApprovalRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

// agent 想执行需授权的工具（write 风险原生 skill / 非 auto 的 MCP）时暂停，弹此卡逐项批/拒。
// 决策组成 { tool_call_id: bool } 回传后端续跑：拒的工具回「用户拒绝」结果、不执行，其余照跑。
// locked = 后面已有新回合或正在续跑，锁死；submitted = 本卡已决策。
export default function ApprovalCard({
  requests,
  locked,
  onDecide,
}: {
  requests: ApprovalRequest[];
  locked: boolean;
  onDecide: (approvals: Record<string, boolean>) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const done = locked || submitted;
  const allDecided = requests.every((r) => r.id in decisions);

  function setAll(v: boolean) {
    if (done) return;
    setDecisions(Object.fromEntries(requests.map((r) => [r.id, v])));
  }
  function setOne(id: string, v: boolean) {
    if (done) return;
    setDecisions((d) => ({ ...d, [id]: v }));
  }
  function submit() {
    if (done || !allDecided) return;
    setSubmitted(true);
    onDecide(decisions);
  }

  return (
    <div className="my-1 rounded border border-terminal-yellow/40 bg-terminal-panel/30 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm text-terminal-yellow">
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current" fill="none" strokeWidth="1.6">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        agent 想执行以下操作，需你授权
      </div>
      {requests.map((r) => {
        const d = decisions[r.id];
        return (
          <div key={r.id} className="space-y-1.5">
            <div className="text-xs font-mono break-all">
              <span className="text-terminal-gray/50">$ </span>
              <span className="text-terminal-green">{r.name}</span>
              {Object.keys(r.args).length > 0 && <span className="text-terminal-gray/60"> {fmtArgs(r.args)}</span>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={done}
                onClick={() => setOne(r.id, true)}
                className={
                  'px-2.5 py-1 rounded border text-xs transition-colors disabled:opacity-70 ' +
                  (d === true
                    ? 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green'
                    : 'border-terminal-line/70 text-terminal-gray hover:border-terminal-green/50 hover:text-terminal-green')
                }
              >
                {d === true ? '✓ ' : ''}批准
              </button>
              <button
                type="button"
                disabled={done}
                onClick={() => setOne(r.id, false)}
                className={
                  'px-2.5 py-1 rounded border text-xs transition-colors disabled:opacity-70 ' +
                  (d === false
                    ? 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red'
                    : 'border-terminal-line/70 text-terminal-gray hover:border-terminal-red/50 hover:text-terminal-red')
                }
              >
                {d === false ? '✓ ' : ''}拒绝
              </button>
            </div>
          </div>
        );
      })}
      {!done && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!allDecided}
            onClick={submit}
            className="text-xs text-terminal-green border border-terminal-green/40 rounded px-3 py-1 hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
          >
            ↵ 执行
          </button>
          {requests.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="text-[11px] text-terminal-gray/60 hover:text-terminal-green transition-colors"
              >
                全部批准
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                className="text-[11px] text-terminal-gray/60 hover:text-terminal-red transition-colors"
              >
                全部拒绝
              </button>
            </>
          )}
        </div>
      )}
      {submitted && <div className="text-xs text-terminal-gray/40">已提交决策</div>}
    </div>
  );
}
