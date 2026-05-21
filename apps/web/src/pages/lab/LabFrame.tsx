import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  slug: string;
  title?: string;
  desc?: string;
  accent?: 'green' | 'cyan' | 'pink' | 'yellow';
  children: ReactNode;
}

const ACCENT_TEXT: Record<NonNullable<Props['accent']>, string> = {
  green: 'text-terminal-green',
  cyan: 'text-terminal-cyan',
  pink: 'text-terminal-pink',
  yellow: 'text-terminal-yellow',
};

export default function LabFrame({ slug, title, desc, accent = 'green', children }: Props) {
  const heading = title ?? slug;
  return (
    <div className="space-y-5">
      <div className="text-xs text-terminal-gray flex items-center gap-2">
        <Link to="/lab" className="hover:text-terminal-green transition-colors">
          ../lab
        </Link>
        <span className="text-terminal-line">/</span>
        <span className="text-terminal-gray/80">{slug}</span>
      </div>
      <h1 className={`text-2xl ${ACCENT_TEXT[accent]}`}>
        <span className="text-terminal-pink">$ </span>./{heading}
      </h1>
      {desc && <p className="text-sm text-terminal-gray">{desc}</p>}
      <div className="rounded-lg overflow-hidden border border-terminal-line/70 bg-terminal-panel/40">
        {children}
      </div>
    </div>
  );
}
