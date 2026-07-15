import { useEffect, useState } from 'react';
import { deleteSession, listSessions, type SessionInfo } from '../lib/api';

// 私有模式「我的会话」面板：拉该 owner 的历史会话，点开续聊、✕ 删除。样式钉在终端色板里。

function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionList({
  token,
  currentId,
  onOpen,
  busy,
}: {
  token: string;
  currentId: string | null;
  onOpen: (sid: string) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    listSessions(token)
      .then((rows) => alive && setItems(rows))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  async function del(e: React.MouseEvent, sid: string) {
    e.stopPropagation();
    setItems((xs) => xs?.filter((x) => x.id !== sid) ?? xs); // 乐观移除
    try {
      await deleteSession(token, sid);
    } catch {
      listSessions(token).then(setItems).catch(() => undefined); // 失败则回滚重拉
    }
  }

  return (
    <div className="sticky top-4 rounded-lg border border-terminal-line/70 bg-terminal-bg/95 p-2 text-xs">
      <div className="px-1 pb-2 mb-1 border-b border-terminal-line/50 text-terminal-gray/60">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">ls</span> ~/sessions
      </div>
      {error && <div className="px-1 py-2 text-terminal-red">加载失败：{error}</div>}
      {!error && items === null && <div className="px-1 py-2 text-terminal-gray/50">加载中…</div>}
      {!error && items?.length === 0 && <div className="px-1 py-2 text-terminal-gray/50">还没有历史会话。</div>}
      <div className="max-h-[60vh] overflow-y-auto">
        {items?.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => !busy && onOpen(s.id)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && onOpen(s.id)}
            className={
              'group flex items-center gap-2 rounded px-1.5 py-1 cursor-pointer transition-colors ' +
              (s.id === currentId
                ? 'bg-terminal-green/10 text-terminal-green'
                : 'text-terminal-gray/80 hover:bg-terminal-line/30 hover:text-terminal-green')
            }
          >
            <span className="text-terminal-gray/40">{s.id === currentId ? '›' : ' '}</span>
            <span className="flex-1 truncate">{s.title || '（未命名）'}</span>
            <span className="text-terminal-gray/40 shrink-0">{fmtWhen(s.updated_at)}</span>
            <button
              type="button"
              onClick={(e) => del(e, s.id)}
              title="删除该会话"
              className="shrink-0 text-terminal-gray/30 hover:text-terminal-red opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
