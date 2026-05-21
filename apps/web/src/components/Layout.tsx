import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';

const NAV = [
  { to: '/', label: '~', exact: true },
  { to: '/posts', label: 'posts' },
  { to: '/inspirations', label: 'inspirations' },
  { to: '/lab', label: 'lab' },
  { to: '/about', label: 'about' },
];

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-terminal-line/60 backdrop-blur sticky top-0 z-50 bg-terminal-bg/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 sm:py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
          <NavLink to="/" className="text-terminal-green font-bold tracking-wide whitespace-nowrap">
            <span className="text-terminal-pink">~$</span> tenggouwa
          </NavLink>
          <nav className="flex gap-3 sm:gap-5 text-sm flex-wrap">
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
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Outlet />
      </main>
      <footer className="border-t border-terminal-line/60 text-xs text-terminal-gray/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:justify-between gap-1">
          <span>© {new Date().getFullYear()} tenggouwa · made with caffeine ☕</span>
          <span className="text-terminal-cyan">[ uptime: ∞ ]</span>
        </div>
      </footer>
    </div>
  );
}
