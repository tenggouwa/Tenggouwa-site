import { useState } from 'react';

// 私有模式解锁面板：输 6 位 TOTP → 交给父组件换 agent_token。纯表单，fetch/状态在父层。
export default function UnlockPanel({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error?: string;
  onSubmit: (totp: string) => void;
}) {
  const [code, setCode] = useState('');
  const ok = /^\d{6}$/.test(code);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ok && !busy) onSubmit(code);
  }

  return (
    <form onSubmit={submit} className="my-1 rounded border border-terminal-yellow/40 bg-terminal-panel/30 p-3 space-y-2">
      <div className="text-xs text-terminal-gray/70">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">unlock</span> --totp
        <span className="text-terminal-gray/50">　# 私有模式：文件读写等高危工具需 TOTP 鉴权</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={busy}
          inputMode="numeric"
          autoFocus
          placeholder="6 位 TOTP 码"
          className="w-40 bg-terminal-bg/60 border border-terminal-line/70 rounded px-2 py-1 text-sm tracking-[0.3em] text-terminal-gray outline-none focus:border-terminal-green/60 placeholder:text-terminal-gray/40 placeholder:tracking-normal disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!ok || busy}
          className="text-xs text-terminal-green border border-terminal-green/40 rounded px-3 py-1 hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
        >
          {busy ? '解锁中…' : '↵ 解锁'}
        </button>
      </div>
      {error && <div className="text-xs text-terminal-red">{error}</div>}
    </form>
  );
}
