import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import { SERIES } from '../lib/series';
import type { PostListPage, PostSummary } from '../lib/types';

const PAGE_SIZE = 10;

export default function PostList() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 首屏
  useEffect(() => {
    apiGet<PostListPage>(`/api/public/posts?limit=${PAGE_SIZE}&offset=0`)
      .then((page) => {
        setPosts(page.items);
        setHasMore(page.has_more);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts == null) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<PostListPage>(
        `/api/public/posts?limit=${PAGE_SIZE}&offset=${posts.length}`,
      );
      setPosts([...posts, ...page.items]);
      setHasMore(page.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, posts]);

  // 哨兵进视口 → 自动拉下一页
  useEffect(() => {
    if (!hasMore || posts == null) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, posts, loadMore]);

  if (error) {
    return (
      <div className="text-red-400">
        <span className="text-terminal-pink">err: </span>
        {error}
      </div>
    );
  }

  if (posts == null) {
    return <TermLoading tip={['fetching posts...', 'parsing markdown...', 'almost there...']} />;
  }

  if (posts.length === 0) {
    return <Empty description="还没有发布的文章 —— admin 后台见。" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-terminal-green text-2xl">
        <span className="text-terminal-pink">$ </span>cat posts/*.md
      </h1>

      {/* 系列入口 */}
      {SERIES.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
          {SERIES.map((s) => (
            <Link
              key={s.tag}
              to={`/series/${s.tag}`}
              className="group block p-3 rounded border border-terminal-line/40
                         hover:border-terminal-green/50 hover:bg-terminal-green/5
                         transition-all"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-terminal-pink shrink-0">~$</span>
                <span className="text-terminal-cyan text-sm">{s.command_hint ?? `ls ${s.tag}/`}</span>
              </div>
              <div className="text-terminal-gray group-hover:text-terminal-green transition-colors font-semibold">
                {s.title} →
              </div>
              <p className="text-xs text-terminal-gray/65 mt-1 line-clamp-2">{s.description}</p>
            </Link>
          ))}
        </div>
      )}

      <ul className="divide-y divide-terminal-line/60">
        {posts.map((p) => (
          <li key={p.id} className="py-5">
            <Link to={`/posts/${p.slug}`} className="group block">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-lg text-terminal-gray group-hover:text-terminal-green transition-colors">
                  {p.title}
                </h2>
                <span className="text-xs text-terminal-gray/70 shrink-0">
                  {p.published_at.slice(0, 10)}
                </span>
              </div>
              <p className="text-sm text-terminal-gray/80 mt-2">{p.summary}</p>
              <div className="mt-2 flex gap-2 flex-wrap">
                {p.tags.map((t) => (
                  <Tag key={t} color="green" size="small">
                    {t}
                  </Tag>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div ref={sentinelRef} className="py-6 text-center text-xs text-terminal-gray/60">
          {loadingMore ? (
            <span>
              <span className="text-terminal-pink">$ </span>fetching more...
            </span>
          ) : (
            <span className="text-terminal-gray/40">↓ scroll for more</span>
          )}
        </div>
      ) : (
        <div className="py-6 text-center text-xs text-terminal-gray/40">
          <span className="text-terminal-pink">$ </span># EOF — {posts.length} posts
        </div>
      )}
    </div>
  );
}
