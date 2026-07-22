import { useEffect, useState } from 'react';
import { deleteInbox, listInbox, readInbox, runProactive, type InboxItem } from '../lib/api';

// 私有模式「收件箱」面板：agent 主动/定时任务的产出。点开看正文并标已读，✕ 删，也能手动触发一次主动运行。
// 「从被动应答到主动行动」的可见落点——定时器（或这里的「跑一次」）让 agent 自主干活，结果异步进这里。

function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function InboxPanel({ token }: { token: string }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function reload() {
    listInbox(token)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }
  useEffect(reload, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = items?.filter((x) => !x.read).length ?? 0;

  async function toggle(it: InboxItem) {
    const next = open === it.id ? null : it.id;
    setOpen(next);
    if (next !== null && !it.read) {
      setItems((xs) => xs?.map((x) => (x.id === it.id ? { ...x, read: true } : x)) ?? xs); // 乐观标已读
      readInbox(token, it.id).catch(() => undefined);
    }
  }

  async function del(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? xs);
    deleteInbox(token, id).catch(reload);
  }

  async function runNow() {
    const p = prompt.trim();
    if (!p || running) return;
    setRunning(true);
    setError(undefined);
    try {
      await runProactive(token, p);
      setPrompt('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '运行失败');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border border-terminal-line/70 bg-terminal-bg/95 p-2 text-xs">
      <div className="px-1 pb-2 mb-1 border-b border-terminal-line/50 text-terminal-gray/60 flex items-center gap-1">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">cat</span> ~/inbox
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-terminal-yellow/20 text-terminal-yellow px-1.5">{unread}</span>
        )}
      </div>

      {/* 手动触发一次主动运行 */}
      <div className="flex items-center gap-1 px-1 pb-2 mb-1 border-b border-terminal-line/40">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runNow()}
          placeholder="让 agent 自主跑个任务…"
          className="flex-1 min-w-0 bg-transparent outline-none text-terminal-gray placeholder:text-terminal-gray/30"
        />
        <button
          type="button"
          onClick={runNow}
          disabled={running || !prompt.trim()}
          className="shrink-0 text-terminal-green/80 hover:text-terminal-green disabled:text-terminal-gray/30"
          title="让 agent 自主完成它，结果进收件箱"
        >
          {running ? '跑…' : '▷跑'}
        </button>
      </div>

      {error && <div className="px-1 py-1 text-terminal-red">{error}</div>}
      {!error && items === null && <div className="px-1 py-2 text-terminal-gray/50">加载中…</div>}
      {!error && items?.length === 0 && (
        <div className="px-1 py-2 text-terminal-gray/50">还没有产出。定时任务或上面「跑一次」会往这里投。</div>
      )}
      <div className="max-h-[40vh] overflow-y-auto">
        {items?.map((it) => (
          <div key={it.id} className="rounded">
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(it)}
              onKeyDown={(e) => e.key === 'Enter' && toggle(it)}
              className="group flex items-center gap-2 px-1.5 py-1 cursor-pointer rounded hover:bg-terminal-line/30"
            >
              {!it.read && <span className="w-1.5 h-1.5 rounded-full bg-terminal-yellow shrink-0" />}
              <span className={'flex-1 truncate ' + (it.read ? 'text-terminal-gray/70' : 'text-terminal-gray/95')}>
                {it.title}
              </span>
              <span className="text-terminal-gray/40 shrink-0">{fmtWhen(it.created_at)}</span>
              <button
                type="button"
                onClick={(e) => del(e, it.id)}
                title="删除"
                className="shrink-0 text-terminal-gray/30 hover:text-terminal-red opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
            {open === it.id && (
              <div className="mt-1 mb-1 ml-2 pl-2 border-l border-terminal-line/50 whitespace-pre-wrap leading-5 text-terminal-gray/70">
                {it.body}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
