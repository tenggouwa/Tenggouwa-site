import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { PostListPage, PostSummary } from '../lib/types';

interface Props {
  tag: string;
  currentSlug: string;
}

// 同系列上一篇/下一篇导航。复用 ?tag= 分页接口拿整个系列，列表按 published_at
// 倒序返回，系列阅读顺序是发布正序，所以 reverse 过来再定位当前文章。
export default function SeriesNav({ tag, currentSlug }: Props) {
  const [siblings, setSiblings] = useState<PostSummary[] | null>(null);

  useEffect(() => {
    apiGet<PostListPage>(`/api/public/posts?tag=${encodeURIComponent(tag)}&limit=100`)
      .then((page) => setSiblings([...page.items].reverse()))
      .catch(() => setSiblings([]));
  }, [tag]);

  if (!siblings) return null;
  const idx = siblings.findIndex((p) => p.slug === currentSlug);
  if (idx === -1) return null;

  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;
  if (!prev && !next) return null;

  return (
    <nav className="grid gap-3 border-t border-terminal-line/60 pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          to={`/posts/${prev.slug}`}
          className="group rounded-lg border border-terminal-line/60 bg-terminal-panel/30 p-4 transition-colors hover:border-terminal-green/50"
        >
          <div className="text-xs text-terminal-pink">~$ prev</div>
          <div className="mt-1 line-clamp-2 text-sm text-terminal-gray group-hover:text-terminal-green">
            {prev.title}
          </div>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to={`/posts/${next.slug}`}
          className="group rounded-lg border border-terminal-line/60 bg-terminal-panel/30 p-4 text-right transition-colors hover:border-terminal-green/50"
        >
          <div className="text-xs text-terminal-pink">next $~</div>
          <div className="mt-1 line-clamp-2 text-sm text-terminal-gray group-hover:text-terminal-green">
            {next.title}
          </div>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
