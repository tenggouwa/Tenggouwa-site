import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'ask', end: true },
  { to: '/graph', label: 'graph' },
  { to: '/arch', label: 'arch' },
  { to: '/skills', label: 'skills' },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-terminal-line/60 backdrop-blur sticky top-0 z-50 bg-terminal-bg/70">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 sm:py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
          <a href="https://tenggouwa.com/" className="text-terminal-green font-bold tracking-wide whitespace-nowrap">
            <span className="text-terminal-pink">~$</span> agent
          </a>
          <nav className="flex gap-3 sm:gap-5 text-sm flex-wrap">
            {NAV.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  'transition-colors hover:text-terminal-green ' +
                  (isActive ? 'text-terminal-green' : 'text-terminal-gray')
                }
              >
                {it.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Outlet />
      </main>
      <footer className="border-t border-terminal-line/60 text-xs text-terminal-gray/70">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex justify-between gap-1">
          <span>agent · tenggouwa</span>
          <a href="https://tenggouwa.com/" className="text-terminal-gray/50 hover:text-terminal-green transition-colors">
            ← tenggouwa.com
          </a>
        </div>
      </footer>
    </div>
  );
}
