import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { trackPageView } from '../lib/track';
import SearchModal from './SearchModal';

const NAV = [
  { to: '/', label: '~', exact: true },
  { to: '/posts', label: 'posts' },
  { to: '/inspirations', label: 'inspirations' },
  { to: '/lab', label: 'lab' },
  { to: '/about', label: 'about' },
];

export default function Layout() {
  const loc = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    // 路由切换 + 首次进入，都打一次 PV
    trackPageView(loc.pathname);
  }, [loc.pathname]);

  // 全局 Cmd+K / Ctrl+K 召唤搜索（在 input/textarea 里不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-terminal-line/60 backdrop-blur sticky top-0 z-50 bg-terminal-bg/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 sm:py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
          <NavLink to="/" className="text-terminal-green font-bold tracking-wide whitespace-nowrap">
            <span className="text-terminal-pink">~$</span> tenggouwa
          </NavLink>
          <nav className="flex items-center gap-3 sm:gap-5 text-sm flex-wrap">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  clsx(
                    'transition-colors hover:text-terminal-green',
                    isActive ? 'text-terminal-green' : 'text-terminal-gray',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 text-terminal-gray hover:text-terminal-green transition-colors"
              aria-label="搜索 (Cmd+K)"
              title="搜索 (Cmd+K)"
            >
              <span>🔍</span>
              <kbd className="hidden sm:inline-block text-[10px] px-1 py-0.5 rounded border border-terminal-line/80 text-terminal-gray/70">
                ⌘K
              </kbd>
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Outlet />
      </main>
      <SearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} />
      <footer className="border-t border-terminal-line/60 text-xs text-terminal-gray/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:justify-between gap-1">
          <span>© {new Date().getFullYear()} tenggouwa · made with caffeine ☕</span>
          <div className="flex items-center gap-3">
            <Link
              to="/console"
              className="text-terminal-gray/50 hover:text-terminal-green transition-colors"
              aria-label="console"
            >
              ~$ console
            </Link>
            <span className="text-terminal-cyan">[ uptime: ∞ ]</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
