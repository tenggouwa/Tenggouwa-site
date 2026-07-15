// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Ask from './Ask';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

// 私有模式下「会话」面板：拉列表 → 点开某会话 → transcript 回填成 turns。
describe('Ask 会话列表 + 续聊', () => {
  it('解锁后点开会话列表、载入历史 transcript', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/api/public/agent/unlock')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env({ token: 'T1', ttl_seconds: 3600 })) });
      }
      if (url.endsWith('/api/agent/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(env([{ id: 's-old', title: '上次的活儿', updated_at: '2026-07-14T10:00:00+00:00' }])),
        });
      }
      if (url.endsWith('/api/agent/sessions/s-old')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              env({
                id: 's-old',
                title: '上次的活儿',
                turns: [{ q: '写个脚本', tools: [{ name: 'file_write', args: { path: 'a.sh' } }], answer: '写好了' }],
              }),
            ),
        });
      }
      return Promise.resolve({ ok: true, status: 200, body: null });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.click(screen.getByTitle(/TOTP 解锁私有模式/));
    fireEvent.change(screen.getByPlaceholderText('6 位 TOTP 码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('↵ 解锁'));
    await waitFor(() => expect(screen.getByText(/私有 · 剩/)).toBeTruthy());

    // 点开「会话」面板 → 列表拉到历史会话
    fireEvent.click(screen.getByTitle(/我的历史会话/));
    await waitFor(() => expect(screen.getByText('上次的活儿')).toBeTruthy());

    // 点开该会话 → transcript 回填：问题 + 答案 + 工具行都在
    fireEvent.click(screen.getByText('上次的活儿'));
    await waitFor(() => expect(screen.getByText('写个脚本')).toBeTruthy());
    expect(screen.getByText('写好了')).toBeTruthy();
    expect(screen.getByText(/path="a\.sh"/)).toBeTruthy(); // 工具行的参数（唯一，避开页脚工具清单）
  });
});
