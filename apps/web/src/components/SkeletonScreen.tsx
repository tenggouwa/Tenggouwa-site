import clsx from 'clsx';

// 终端风骨架条：底色面板 + 一道绿色微光从左扫到右（shimmer），贴 CRT hacker 调性。
function Bar({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded border border-terminal-line/40 bg-terminal-panel/50',
        className,
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-terminal-green/20 to-transparent" />
    </div>
  );
}

// 路由 chunk 懒加载时的内容区占位。模拟「标题 + meta + 段落 + 代码块」的文章骨架，
// 顶部带一行 shell prompt + 闪烁光标，整体罩在 boxShadow.glow 的淡绿光晕里。
export default function SkeletonScreen() {
  return (
    <div className="space-y-6">
      <div className="font-mono text-sm text-terminal-gray/50">
        <span className="text-terminal-pink">~$</span>{' '}
        <span className="text-terminal-green">load</span>{' '}
        <span className="text-terminal-gray/40">--stream ./</span>
        <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] bg-terminal-green/80 animate-blink" />
      </div>

      <div className="space-y-4 rounded-lg border border-terminal-line/40 bg-terminal-panel/20 p-5 shadow-glow">
        <Bar className="h-8 w-2/3" />
        <Bar className="h-4 w-1/3" />
        <div className="space-y-3 pt-3">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-[92%]" />
          <Bar className="h-4 w-4/5" />
        </div>
        <Bar className="h-36 w-full" />
        <div className="space-y-3">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-5/6" />
          <Bar className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
