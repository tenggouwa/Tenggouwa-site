// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Ask from './Ask';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function sseStream(frames: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}
const frame = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// TOTP 解锁 → 后续对话打私有端点并带 Bearer token。
describe('Ask private mode', () => {
  it('解锁后 chat 走 /api/agent/chat + Authorization: Bearer', async () => {
    const calls: Array<{ url: string; opts: { headers?: Record<string, string>; body?: string } }> = [];
    const fetchMock = vi.fn((url: string, opts: { headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, opts });
      if (url.endsWith('/api/public/agent/unlock')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 0, message: '', data: { token: 'T1', ttl_seconds: 3600 } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body: sseStream([
          frame('session', { type: 'session', session_id: 's1' }),
          frame('token', { type: 'token', delta: '好的' }),
          frame('done', { type: 'done' }),
        ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);

    // 打开解锁面板 → 输 TOTP → 解锁
    fireEvent.click(screen.getByTitle(/TOTP 解锁私有模式/));
    fireEvent.change(screen.getByPlaceholderText('6 位 TOTP 码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('↵ 解锁'));

    // 解锁成功 → 顶栏出现私有指示
    await waitFor(() => expect(screen.getByText(/私有 · 剩/)).toBeTruthy());
    const unlockCall = calls.find((c) => c.url.endsWith('/api/public/agent/unlock'));
    expect(JSON.parse(unlockCall!.opts.body!)).toEqual({ totp: '123456' });

    // 发一条对话 → 打私有端点、带 Bearer
    fireEvent.change(screen.getByPlaceholderText(/问一个问题/), { target: { value: '读下文件' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);

    await waitFor(() => expect(screen.getByText('好的')).toBeTruthy());
    const chatCall = calls.find((c) => c.url.endsWith('/api/agent/chat'));
    expect(chatCall).toBeTruthy();
    expect(chatCall!.opts.headers?.Authorization).toBe('Bearer T1');
    // 公开端点不该被对话请求命中
    expect(calls.some((c) => c.url.endsWith('/api/public/agent/chat'))).toBe(false);
  });

  it('注销全部 → 打 /api/agent/revoke 带 Bearer，然后锁回公开', async () => {
    const calls: Array<{ url: string; opts: { headers?: Record<string, string> } }> = [];
    const fetchMock = vi.fn((url: string, opts: { headers?: Record<string, string> }) => {
      calls.push({ url, opts });
      if (url.endsWith('/api/public/agent/unlock')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 0, message: '', data: { token: 'T1', ttl_seconds: 3600 } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200 }); // /revoke
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.click(screen.getByTitle(/TOTP 解锁私有模式/));
    fireEvent.change(screen.getByPlaceholderText('6 位 TOTP 码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('↵ 解锁'));
    await waitFor(() => expect(screen.getByText('注销全部')).toBeTruthy());

    fireEvent.click(screen.getByText('注销全部'));

    // 锁回公开：私有指示消失、「私有」解锁按钮回来
    await waitFor(() => expect(screen.getByTitle(/TOTP 解锁私有模式/)).toBeTruthy());
    const revokeCall = calls.find((c) => c.url.endsWith('/api/agent/revoke'));
    expect(revokeCall).toBeTruthy();
    expect(revokeCall!.opts.headers?.Authorization).toBe('Bearer T1');
    expect(screen.queryByText(/私有 · 剩/)).toBeNull();
  });

  it('公开模式（未解锁）chat 走公开端点、无 Authorization', async () => {
    const calls: Array<{ url: string; opts: { headers?: Record<string, string> } }> = [];
    const fetchMock = vi.fn((url: string, opts: { headers?: Record<string, string> }) => {
      calls.push({ url, opts });
      return Promise.resolve({
        ok: true,
        status: 200,
        body: sseStream([frame('session', { type: 'session', session_id: 's1' }), frame('done', { type: 'done' })]),
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/问一个问题/), { target: { value: '你好' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url.endsWith('/api/public/agent/chat')).toBe(true);
    expect(calls[0].opts.headers?.Authorization).toBeUndefined();
  });
});
