import { useEffect, useState } from 'react';
import { Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import type { Inspiration, InspirationListPage } from '../lib/types';

const PAGE = 20;

export default function Inspirations() {
  const [list, setList] = useState<Inspiration[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(offset: number) {
    const page = await apiGet<InspirationListPage>(
      `/api/public/inspirations?limit=${PAGE}&offset=${offset}`,
    );
    setList((prev) => (offset === 0 || prev == null ? page.items : [...prev, ...page.items]));
    setHasMore(page.has_more);
  }

  useEffect(() => {
    load(0).catch((e: Error) => setError(e.message));
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      await load(list?.length ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) {
    return (
      <div className="text-red-400">
        <span className="text-terminal-pink">err: </span>
        {error}
      </div>
    );
  }
  if (list == null) {
    return <TermLoading tip={['tailing thoughts.log...', 'sorting by mood...']} />;
  }
  if (list.length === 0) {
    return <Empty description="脑袋空空 —— 还没有小灵感。" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-terminal-cyan text-2xl">
        <span className="text-terminal-pink">$ </span>tail -f thoughts.log
      </h1>
      <div className="columns-1 md:columns-2 gap-4 [column-fill:_balance]">
        {list.map((i) => (
          <div
            key={i.id}
            className="break-inside-avoid mb-4 border border-terminal-line/70 bg-terminal-panel/40 rounded-lg p-4"
          >
            <div className="text-sm whitespace-pre-wrap text-terminal-gray">{i.content}</div>
            <div className="mt-3 text-[10px] text-terminal-gray/70 flex justify-between">
              <span>{i.created_at.slice(0, 16).replace('T', ' ')}</span>
              {i.mood && <span className="text-terminal-yellow">{i.mood}</span>}
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="font-mono text-sm text-terminal-green hover:text-terminal-cyan disabled:opacity-50"
        >
          <span className="text-terminal-pink">$ </span>
          {loadingMore ? 'loading...' : 'load more'}
        </button>
      )}
    </div>
  );
}
