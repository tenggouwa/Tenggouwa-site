// M1 占位壳。M3 会做 skill 抽象 + 后端注册表接口，这里动态列出 agent 可调用的 skill。

interface SkillCard {
  name: string;
  desc: string;
  status: 'ready' | 'planned';
}

const SKILLS: SkillCard[] = [
  { name: 'kb.search', desc: '检索知识库（向量 + trigram 混合），返回相关片段与来源', status: 'ready' },
  { name: 'kb.reindex', desc: '重建知识库索引（把新内容灌进去）', status: 'planned' },
  { name: 'web.fetch', desc: '抓取一个 URL 的正文', status: 'planned' },
];

export default function Skills() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>skills
        </h1>
        <p className="text-sm text-terminal-gray/70">
          agent 能调用的工具。「查知识库」就是其中一个 skill；未来 agent 会自己决定调哪个。
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {SKILLS.map((s) => (
          <div
            key={s.name}
            className="rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <code className="text-terminal-cyan">{s.name}</code>
              <span
                className={
                  'text-[10px] px-1.5 py-0.5 rounded border ' +
                  (s.status === 'ready'
                    ? 'border-terminal-green/50 text-terminal-green'
                    : 'border-terminal-line/70 text-terminal-gray/50')
                }
              >
                {s.status === 'ready' ? 'ready' : 'planned'}
              </span>
            </div>
            <p className="text-xs text-terminal-gray/75 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-terminal-line/60 bg-terminal-bg/40 p-8 text-center text-sm text-terminal-gray/50">
        <span className="text-terminal-green">// TODO(M3)</span> 后端 skill 注册表 + tool schema，agent 通过 function-calling 调用；这里动态渲染。
      </div>
    </div>
  );
}
