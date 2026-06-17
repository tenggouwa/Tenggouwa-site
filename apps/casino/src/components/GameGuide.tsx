// 游戏说明面板：终端 `$ man <game>` 风，含"玩法"与"真相"两段。各游戏页统一用。

export default function GameGuide({ cmd, how, truth }: { cmd: string; how: string[]; truth: string }) {
  return (
    <div className="rounded-lg border border-terminal-line bg-terminal-panel/40 p-4 text-xs leading-relaxed">
      <div className="mb-3 text-terminal-gray/60">
        <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">man</span> {cmd}
      </div>
      <div className="mb-1 text-terminal-cyan">玩法</div>
      <ul className="mb-3 space-y-1 text-terminal-gray/80">
        {how.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-terminal-gray/40">-</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mb-1 text-terminal-pink">真相</div>
      <p className="text-terminal-gray/80">{truth}</p>
    </div>
  );
}
