import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { trackPageView } from '../lib/track';
import SearchModal from './SearchModal';
import SkeletonScreen from './SkeletonScreen';

const NAV = [
  { to: '/', label: '~', exact: true },
  { to: '/posts', label: 'posts' },
  { to: '/inspirations', label: 'inspirations' },
  { to: '/lab', label: 'lab' },
  { to: '/pi', label: 'pi' },
  { to: '/about', label: 'about' },
];

export default function Layout() {
  const loc = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    // 路由切换 + 首次进入，都打一次 PV
    trackPageView(loc.pathname);
  }, [loc.pathname]);

  // 全局 Cmd/Ctrl+K 和 Cmd/Ctrl+F 都召唤搜索（在 input/textarea 里不拦截）
  // Cmd+F 是浏览器原生页内查找，主动拦截覆盖成站内搜索——更贴合用户预期
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (isMeta && (key === 'k' || key === 'f')) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        // 在 input 里也允许 Cmd+K 召唤；但 Cmd+F 只在非 input 区拦截，
        // 避免抢掉用户在表单里的查找需求
        if (key === 'f' && (tag === 'INPUT' || tag === 'TEXTAREA')) return;
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
            {/* casino 是独立 SPA（不同 basename），用整页跳转而非 router Link。
                ${BASE_URL}casino/ 在子路径(/Tenggouwa-site/casino/)与根域(/casino/)都成立。 */}
            <a
              href={`${import.meta.env.BASE_URL}casino/`}
              className="transition-colors text-terminal-pink hover:text-terminal-green"
              title="反赌模拟器：用真实赔率看清赌博"
            >
              casino
            </a>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group flex items-center gap-2 px-2.5 py-1 rounded border border-terminal-line/60 hover:border-terminal-green/60 bg-terminal-panel/30 hover:bg-terminal-panel/60 transition-all text-xs"
              aria-label="search"
              title="search · ⌘K / ⌘F"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-terminal-gray/70 group-hover:text-terminal-green transition-colors"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span className="hidden sm:inline text-terminal-gray/70 group-hover:text-terminal-gray">
                search
              </span>
              <kbd className="hidden sm:inline-flex items-center justify-center text-[9px] px-1.5 py-0.5 rounded border border-terminal-line/70 bg-terminal-bg/60 text-terminal-gray/60 ml-1 font-mono leading-none">
                ⌘K
              </kbd>
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Suspense fallback={<SkeletonScreen />}>
          <Outlet />
        </Suspense>
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
