import { useEffect } from 'react';

// 问答已迁到独立的 agent 平台（/agent/）。/ask 直接整页跳过去，兜住书签 / 老链接。
export default function Ask() {
  useEffect(() => {
    window.location.replace(`${import.meta.env.BASE_URL}agent/`);
  }, []);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-terminal-gray/60 font-mono text-sm">
      <span className="text-terminal-pink">~$</span>
      <span className="ml-2">正在跳转到 agent…</span>
    </div>
  );
}
