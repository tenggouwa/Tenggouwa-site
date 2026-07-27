import { useEffect, useState } from 'react';
import { deleteSkillProposal, listSkillProposals, type SkillProposal } from '../lib/api';

// skills 页的「agent 提议的新技能」区块：agent 撞到能力缺口时自提的 skill 规格，站主在此评审 / ✕ 删。
// 提案不会自动生效——是「该有但没有的工具」的建议，看完自己决定要不要人工实现。仅私有通道（需 agent_token）。

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

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-terminal-green text-lg">
          <span className="text-terminal-pink">$ </span>agent 提议的新技能
        </h2>
        <p className="text-xs text-terminal-gray/60">
          agent 撞到「该做但没有对应工具」时会在这里提议一个 skill 规格。不会自动生效——看完你决定要不要实现。
        </p>
      </div>

      {error && <div className="text-sm text-terminal-red">加载失败：{error}</div>}
      {!error && items === null && <div className="text-sm text-terminal-gray/50">加载中…</div>}
      {!error && items?.length === 0 && (
        <div className="text-xs text-terminal-gray/45">
          暂无提案。私有模式下问 agent 一件它现在做不到的事（如「发封邮件」），它会在这里提议对应的新技能。
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((p) => {
            const props = (p.parameters?.properties ?? {}) as Record<string, unknown>;
            const params = Object.keys(props);
            return (
              <div
                key={p.id}
                className="group rounded-lg border border-terminal-yellow/40 bg-terminal-yellow/[0.04] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-terminal-cyan">{p.name}</code>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-terminal-yellow/50 text-terminal-yellow">
                      待评审
                    </span>
                    <button
                      type="button"
                      onClick={() => del(p.id)}
                      title="删掉这条提案"
                      className="text-terminal-gray/30 hover:text-terminal-red opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <p className="text-xs text-terminal-gray/75 leading-relaxed">{p.description}</p>
                {params.length > 0 && (
                  <div className="text-[11px] text-terminal-gray/55">
                    参数：
                    {params.map((k) => (
                      <code key={k} className="text-terminal-yellow ml-1">
                        {k}
                      </code>
                    ))}
                  </div>
                )}
                {p.rationale && <div className="text-[11px] text-terminal-gray/45">缺口：{p.rationale}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
