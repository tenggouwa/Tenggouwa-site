import { useEffect, useState } from 'react';
import { Spin, Empty } from '@arco-design/web-react';
import { apiGet } from '../lib/api';
import type { Inspiration } from '../lib/types';

export default function Inspirations() {
  const [list, setList] = useState<Inspiration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Inspiration[]>('/api/public/inspirations')
      .then(setList)
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
  if (list == null) {
    return (
      <div className="py-20 text-center">
        <Spin tip="加载灵感中..." />
      </div>
    );
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
    </div>
  );
}
