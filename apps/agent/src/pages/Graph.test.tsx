// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// react-force-graph-2d 靠 canvas，happy-dom 跑不了——mock 成把节点渲染成可点按钮，
// 好断言数据流（加载 → 渲染节点 → 点节点拉邻域详情）。
vi.mock('react-force-graph-2d', () => ({
  default: (props: {
    graphData: { nodes: { id: number; name: string }[] };
    onNodeClick: (n: { id: number }) => void;
  }) => (
    <div data-testid="fg">
      {props.graphData.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => props.onNodeClick(n)}>
          node:{n.name}
        </button>
      ))}
    </div>
  ),
}));

import Graph from './Graph';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

const FULL = {
  nodes: [
    { id: 67, name: 'Transformer', type: '技术', docs: 6, deg: 16, series: 'ai' },
    { id: 285, name: 'Docker', type: '技术', docs: 6, deg: 8, series: 'linux' },
  ],
  edges: [{ source: 67, target: 285, type: '相关' }],
  stats: { entities: 529, relations: 499, docs_total: 57, docs_graphed: 57 },
};
const OVERVIEW = [{ kind: 'blog', documents: 57, chunks: 572, embedded: 572, last_synced_at: '2026-07-16T02:00:00' }];
const NB = {
  center: 67,
  nodes: [
    { id: 67, name: 'Transformer', type: '技术', series: 'ai' },
    { id: 999, name: 'attention', type: '概念', series: 'ai' },
  ],
  edges: [{ source: 999, target: 67, type: '基于', description: 'd' }],
  docs: [{ title: 'GPT 家族', url: '/posts/gpt/' }],
};

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      let body: unknown = env([]);
      if (url.includes('/graph/full')) body = env(FULL);
      else if (url.includes('/kb/overview')) body = env(OVERVIEW);
      else if (url.includes('/graph/entity/')) body = env(NB);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch,
  );
}

describe('Graph 概念图谱页（力导向全图）', () => {
  it('加载后画全图 + 顶部统计条（源 + 图谱覆盖度）', async () => {
    stub();
    render(<Graph />, { wrapper: MemoryRouter });
    // 力导向图渲染出全部节点
    await waitFor(() => expect(screen.getByText('node:Transformer')).toBeTruthy());
    expect(screen.getByText('node:Docker')).toBeTruthy();
    // 统计条
    expect(screen.getByText(/529/)).toBeTruthy(); // 实体数
    expect(screen.getByText('57/57')).toBeTruthy(); // 已抽取 / 总文档
  });

  it('点节点 → 拉邻域，弹出详情卡（关系 + 佐证文章链接）', async () => {
    stub();
    render(<Graph />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('node:Transformer')).toBeTruthy());
    fireEvent.click(screen.getByText('node:Transformer'));
    // 详情卡：中心概念 + 佐证文章成可点链接
    await waitFor(() => {
      const a = screen.getByText('《GPT 家族》').closest('a');
      expect(a?.getAttribute('href')).toBe('https://tenggouwa.com/posts/gpt/');
    });
  });
});
