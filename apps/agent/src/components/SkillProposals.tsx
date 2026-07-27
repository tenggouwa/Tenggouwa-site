import { useEffect, useState } from 'react';
import { deleteSkillProposal, listSkillProposals, type SkillProposal } from '../lib/api';

// 私有模式「技能提案」面板：列出 agent 撞到能力缺口时自提的 skill 规格，✕ 删。
// 提案不会自动生效——是留给站主看的「该有但没有的工具」建议，看完自己决定要不要实现。

export default function SkillProposals({ token }: { token: string }) {
  const [items, setItems] = useState<SkillProposal[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    listSkillProposals(token)
      .then((rows) => alive && setItems(rows))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  async function del(id: number) {
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? xs);
    try {
      await deleteSkillProposal(token, id);
    } catch {
      listSkillProposals(token)
        .then(setItems)
        .catch(() => undefined);
    }
  }

  if (!error && (items === null || items.length === 0)) return null; // 没提案就不占地方

  return (
    <div className="rounded-lg border border-terminal-line/70 bg-terminal-bg/95 p-2 text-xs">
      <div className="px-1 pb-2 mb-1 border-b border-terminal-line/50 text-terminal-gray/60">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">cat</span> ~/skill-proposals
        {items && <span className="text-terminal-gray/40"> · {items.length}</span>}
      </div>
      {error && <div className="px-1 py-2 text-terminal-red">加载失败：{error}</div>}
      <div className="max-h-[40vh] overflow-y-auto space-y-2">
        {items?.map((p) => (
          <div key={p.id} className="group rounded px-1.5 py-1 hover:bg-terminal-line/20">
            <div className="flex items-center gap-2">
              <span className="text-terminal-cyan font-mono flex-1 truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => del(p.id)}
                title="删掉这条提案"
                className="shrink-0 text-terminal-gray/30 hover:text-terminal-red opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
            <div className="text-terminal-gray/70 mt-0.5">{p.description}</div>
            {p.rationale && <div className="text-terminal-gray/40 mt-0.5">缺口：{p.rationale}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
