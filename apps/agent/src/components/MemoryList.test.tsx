// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryList from './MemoryList';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

const MEMS = [
  { id: 1, content: '用户偏好暗色终端风', created_at: '2026-07-18T02:00:00' },
  { id: 2, content: '部署走 pnpm deploy:server', created_at: '2026-07-18T03:00:00' },
];

describe('MemoryList 记忆面板', () => {
  it('列出记忆，✕ 删除乐观移除并打 DELETE', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || 'GET' });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env(MEMS)) });
      }) as unknown as typeof fetch,
    );

    render(<MemoryList token="t" />);
    await waitFor(() => expect(screen.getByText('用户偏好暗色终端风')).toBeTruthy());
    expect(screen.getByText('部署走 pnpm deploy:server')).toBeTruthy();

    // 删第一条 → 乐观从列表消失 + 打了 DELETE /memories/1
    fireEvent.click(screen.getAllByTitle('忘掉这条')[0]);
    await waitFor(() => expect(screen.queryByText('用户偏好暗色终端风')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/memories/1'))).toBe(true);
  });

  it('空态给出提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env([])) }),
      ) as unknown as typeof fetch,
    );
    render(<MemoryList token="t" />);
    await waitFor(() => expect(screen.getByText(/还没记住什么/)).toBeTruthy());
  });
});
