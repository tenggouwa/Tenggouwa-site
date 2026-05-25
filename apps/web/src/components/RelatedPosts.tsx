import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { PostSummary } from '../lib/types';

interface Props {
  slug: string;
}

export default function RelatedPosts({ slug }: Props) {
  const [items, setItems] = useState<PostSummary[] | null>(null);

  useEffect(() => {
    if (!slug) return;
    setItems(null);
    apiGet<PostSummary[]>(`/api/public/posts/${slug}/related?limit=3`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [slug]);

  if (items == null || items.length === 0) return null;

  return (
    <section className="mt-12 pt-6 border-t border-terminal-line/60 font-mono">
      <h3 className="text-terminal-green text-sm mb-3 flex items-center gap-1.5">
        <span className="text-terminal-pink">$</span>
        <span>ls related/</span>
      </h3>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              to={`/posts/${p.slug}`}
              className="group block p-2 rounded border border-terminal-line/40
                         hover:border-terminal-green/50 hover:bg-terminal-green/5
                         transition-all"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-terminal-gray group-hover:text-terminal-green transition-colors text-sm">
                  {p.title}
                </h4>
                <span className="text-[10px] text-terminal-gray/50 shrink-0">
                  {p.published_at.slice(0, 10)}
                </span>
              </div>
              {p.summary && (
                <p className="text-xs text-terminal-gray/70 mt-1 line-clamp-2">{p.summary}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
