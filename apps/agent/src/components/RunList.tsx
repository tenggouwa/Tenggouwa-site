import { useEffect, useState } from 'react';
import { listAgentRuns, type AgentRunItem } from '../lib/api';

// 可审计的运行摘要：刻意不展示 prompt、答案、工具参数或输出，避免把私密对话复制到另一个面板。
export default function RunList({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [items, setItems] = useState<AgentRunItem[]>([]);

  useEffect(() => {
    listAgentRuns(token).then(setItems).catch(() => setItems([]));
  }, [token, refreshKey]);

  return (
    <section className="rounded-lg border border-terminal-line/60 bg-terminal-panel/30 p-3 space-y-2">
      <h2 className="text-xs text-terminal-green"><span className="text-terminal-pink">$ </span>runs</h2>
      {items.length === 0 ? (
        <p className="text-[11px] text-terminal-gray/50">暂无运行记录</p>
      ) : (
        <ul className="space-y-1.5 text-[11px]">
          {items.slice(0, 8).map((run) => (
            <li key={run.id} className="border-t border-terminal-line/40 pt-1.5 text-terminal-gray/70">
              <div className="flex justify-between gap-1"><span className="text-terminal-cyan">{run.model}</span><span>{run.status}</span></div>
              <div>{run.tool_count ? run.tool_names.join(', ') : 'no tools'} · {run.duration_ms ?? '?'}ms</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
