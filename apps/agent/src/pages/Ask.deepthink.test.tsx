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

describe('Ask 深度思考', () => {
  it('开启后请求带 deep_think:true，reasoning 事件渲染成思考过程', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn((_url: string, opts: { body?: string }) => {
      bodies.push(JSON.parse(opts.body!));
      return Promise.resolve({
        ok: true,
        status: 200,
        body: sseStream([
          frame('session', { session_id: 's1' }),
          frame('reasoning', { delta: '先拆解问题' }),
          frame('token', { delta: '最终答案' }),
          frame('done', {}),
        ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.click(screen.getByText(/深度思考/)); // 开启
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: '一道难题' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);

    await waitFor(() => expect(screen.getByText('最终答案')).toBeTruthy());
    expect(bodies[0].deep_think).toBe(true);
    expect(screen.getByText('先拆解问题')).toBeTruthy(); // 思维链展示出来
    expect(screen.getByText('思考过程')).toBeTruthy();
  });

  it('默认关闭时 deep_think:false', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body?: string }) => {
        bodies.push(JSON.parse(opts.body!));
        return Promise.resolve({ ok: true, status: 200, body: sseStream([frame('done', {})]) });
      }) as unknown as typeof fetch,
    );
    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: 'x' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].deep_think).toBe(false);
  });
});
