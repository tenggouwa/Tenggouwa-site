import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

interface SkillInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export default function Skills() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SkillInfo[]>('/api/public/skills')
      .then(setSkills)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>skills
        </h1>
        <p className="text-sm text-terminal-gray/70">
          agent 能调用的工具。「查知识库」就是其中一个 skill；未来 agent 会自己决定调哪个（tool-calling）。
        </p>
      </div>

      {error && <div className="text-sm text-terminal-red">加载失败：{error}</div>}
      {!skills && !error && <div className="text-sm text-terminal-gray/50">加载中…</div>}

      {skills && (
        <div className="grid sm:grid-cols-2 gap-4">
          {skills.map((s) => {
            const props = (s.parameters?.properties ?? {}) as Record<string, { description?: string }>;
            const params = Object.keys(props);
            return (
              <div key={s.name} className="rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <code className="text-terminal-cyan">{s.name}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-terminal-green/50 text-terminal-green">
                    ready
                  </span>
                </div>
                <p className="text-xs text-terminal-gray/75 leading-relaxed">{s.description}</p>
                {params.length > 0 && (
                  <div className="text-[11px] text-terminal-gray/55">
                    参数：
                    {params.map((p) => (
                      <code key={p} className="text-terminal-yellow ml-1">
                        {p}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-terminal-gray/40">
        更多 skill 计划中（kb_reindex / web_fetch …）。M4 会让 ask 页的 agent 自主调用这些工具。
      </p>
    </div>
  );
}
