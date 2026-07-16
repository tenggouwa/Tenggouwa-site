// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Graph from './Graph';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

const HUBS = [
  { id: 67, name: 'Transformer', type: '技术', docs: 6, rels: 16 },
  { id: 285, name: 'Docker', type: '技术', docs: 6, rels: 8 },
];
const NB = (center: number, centerName: string) =>
  env({
    center,
    nodes: [
      { id: center, name: centerName, type: '技术', series: 'ai' },
      { id: 999, name: 'attention', type: '概念', series: 'ai' },
    ],
    edges: [{ source: 999, target: center, type: '基于', description: 'd' }],
    docs: [{ title: 'GPT 家族', url: '/posts/gpt/' }],
  });

const STATS = { entities: 529, relations: 499, docs_total: 57, docs_graphed: 57 };
const OVERVIEW = [{ kind: 'blog', documents: 57, chunks: 572, embedded: 572, last_synced_at: '2026-07-16T02:00:00' }];

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      let body: unknown = env([]);
      if (url.includes('/graph/hubs')) body = env({ hubs: HUBS, stats: STATS });
      else if (url.includes('/kb/overview')) body = env(OVERVIEW);
      else if (url.includes('/graph/entity/285')) body = NB(285, 'Docker');
      else if (url.includes('/graph/entity/')) body = NB(67, 'Transformer');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch,
  );
}

describe('Graph 概念图谱页', () => {
  it('着陆列枢纽 + 自动展开第一个的邻域（节点/边/佐证文章）', async () => {
    stub();
    render(<Graph />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getAllByText('Transformer').length).toBeGreaterThan(0));
    // 邻域画出来了：中心 + 邻居都在 SVG 里
    await waitFor(() => expect(screen.getByText('attention')).toBeTruthy());
    expect(screen.getByText('基于')).toBeTruthy(); // 边的类型标签
    // 佐证文章成可点链接
    const a = screen.getByText('《GPT 家族》').closest('a');
    expect(a?.getAttribute('href')).toBe('https://tenggouwa.com/posts/gpt/');
    // knowledge-base 并进来的统计条：源 + 图谱覆盖度
    expect(screen.getByText(/529/)).toBeTruthy(); // 实体数
    expect(screen.getByText('57/57')).toBeTruthy(); // 已抽取 / 总文档
  });

  it('点侧栏另一个枢纽 → 切换到它的邻域', async () => {
    stub();
    render(<Graph />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('Docker')).toBeTruthy());
    fireEvent.click(screen.getByText('Docker'));
    await waitFor(() => expect(screen.getByText(/~\/graph · Docker/)).toBeTruthy());
  });
});
