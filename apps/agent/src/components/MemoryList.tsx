import { useEffect, useState } from 'react';
import { deleteMemory, listMemories, type MemoryItem } from '../lib/api';

// 私有模式「记忆」面板：列出 agent 记住的关于你的长期事实，✕ 手动删。样式钉在终端色板里。
// 记忆是 agent 自己写的（remember skill）；这里只读+删，不提供手动新增（那是对话里说「记住…」的活）。

export default function MemoryList({ token }: { token: string }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    listMemories(token)
      .then((rows) => alive && setItems(rows))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  async function del(id: number) {
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? xs); // 乐观移除
    try {
      await deleteMemory(token, id);
    } catch {
      listMemories(token)
        .then(setItems)
        .catch(() => undefined); // 失败则回滚重拉
    }
  }

  return (
    <div className="rounded-lg border border-terminal-line/70 bg-terminal-bg/95 p-2 text-xs">
      <div className="px-1 pb-2 mb-1 border-b border-terminal-line/50 text-terminal-gray/60">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">cat</span> ~/memory
        {items && items.length > 0 && <span className="text-terminal-gray/40"> · {items.length}</span>}
      </div>
      {error && <div className="px-1 py-2 text-terminal-red">加载失败：{error}</div>}
      {!error && items === null && <div className="px-1 py-2 text-terminal-gray/50">加载中…</div>}
      {!error && items?.length === 0 && (
        <div className="px-1 py-2 text-terminal-gray/50">还没记住什么。对话里说「记住…」它就会记。</div>
      )}
      <div className="max-h-[40vh] overflow-y-auto">
        {items?.map((m) => (
          <div
            key={m.id}
            className="group flex items-start gap-2 rounded px-1.5 py-1 text-terminal-gray/80 hover:bg-terminal-line/30"
          >
            <span className="text-terminal-gray/40 shrink-0">-</span>
            <span className="flex-1 break-words">{m.content}</span>
            <button
              type="button"
              onClick={() => del(m.id)}
              title="忘掉这条"
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
