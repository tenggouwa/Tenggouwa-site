// 全站外壳：终端霓虹风顶栏 + 钱包条 + 反赌警示带。

import { Link, useLocation } from 'react-router-dom';
import WalletBar from './WalletBar';

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const onTruth = loc.pathname.startsWith('/truth');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-terminal-line/60 bg-terminal-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="text-terminal-pink">~$</span>
            <span className="font-semibold text-terminal-green transition group-hover:text-terminal-cyan">
              ./casino
            </span>
            <span className="hidden text-xs text-terminal-gray/50 sm:inline">— 赌场真相模拟器</span>
          </Link>
          <div className="flex items-center gap-4">
            <WalletBar />
            <Link
              to="/truth"
              className={
                'rounded border px-2.5 py-1 text-xs transition ' +
                (onTruth
                  ? 'border-terminal-pink/70 text-terminal-pink shadow-glow-pink'
                  : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-pink/60 hover:text-terminal-pink')
              }
            >
              📉 看真相
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-terminal-line/60 px-4 py-4 text-center text-xs text-terminal-gray/50">
        积分纯计数 · 无充值无提现 · 本站旨在用真实赔率展示赌博的长期必输
      </footer>
    </div>
  );
}
