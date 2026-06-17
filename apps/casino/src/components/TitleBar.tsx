// 终端窗口标题栏：mac 红黄绿三色点 + 一行 path 文字。项目签名装饰。

export default function TitleBar({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-terminal-line/60 px-4 py-2.5">
      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      <span className="ml-3 truncate text-xs text-terminal-gray/70">{path}</span>
    </div>
  );
}
