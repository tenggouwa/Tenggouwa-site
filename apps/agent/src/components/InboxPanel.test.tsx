// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InboxPanel from './InboxPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });
const ITEMS = [
  { id: 1, title: '每日简报', body: '今天有 3 条动态：…', created_at: '2026-07-22T02:00:00', read: false },
  { id: 2, title: '旧任务', body: '正文二', created_at: '2026-07-21T02:00:00', read: true },
];

describe('InboxPanel 收件箱', () => {
  it('列出产出 + 未读 badge；点开看正文并标已读', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || 'GET' });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env(ITEMS)) });
      }) as unknown as typeof fetch,
    );
    render(<InboxPanel token="t" />);
    await waitFor(() => expect(screen.getByText('每日简报')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy(); // 未读 badge = 1

    fireEvent.click(screen.getByText('每日简报')); // 展开
    await waitFor(() => expect(screen.getByText(/今天有 3 条动态/)).toBeTruthy());
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/inbox/1/read'))).toBe(true); // 标已读
  });

  it('「跑一次」触发主动运行（POST /proactive/run 带 prompt）', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/proactive/run')) bodies.push(init?.body as string);
        const data = url.endsWith('/proactive/run') ? { inbox_id: 9 } : ITEMS;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env(data)) });
      }) as unknown as typeof fetch,
    );
    render(<InboxPanel token="t" />);
    await waitFor(() => expect(screen.getByText('每日简报')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/自主跑个任务/), { target: { value: '看看站点动态' } });
    fireEvent.click(screen.getByText('▷跑'));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(JSON.parse(bodies[0]).prompt).toBe('看看站点动态');
  });
});
