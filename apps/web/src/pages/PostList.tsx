import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import type { PostSummary } from '../lib/types';

export default function PostList() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PostSummary[]>('/api/public/posts')
      .then(setPosts)
      .catch((e: Error) => setError(e.message));
  }, []);

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
    </div>
  );
}
