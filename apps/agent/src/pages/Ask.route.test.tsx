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

describe('Ask 模型路由', () => {
  it('开启智能选模型后请求带 auto_model:true，route 事件渲染路由决策', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body?: string }) => {
        bodies.push(JSON.parse(opts.body!));
        return Promise.resolve({
          ok: true,
          status: 200,
          body: sseStream([
            frame('session', { session_id: 's1' }),
            frame('route', { model: 'reasoner', reason: '需要多步推理' }),
            frame('token', { delta: '答案' }),
            frame('done', {}),
          ]),
        });
      }) as unknown as typeof fetch,
    );

    render(<Ask />);
    fireEvent.click(screen.getByText(/智能选模型/)); // 开启
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: '证明勾股定理' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);

    await waitFor(() => expect(screen.getByText('答案')).toBeTruthy());
    expect(bodies[0].auto_model).toBe(true);
    expect(screen.getByText('深度推理模型')).toBeTruthy(); // 路由决策展示
    expect(screen.getByText(/需要多步推理/)).toBeTruthy();
  });

  it('默认关闭时 auto_model:false', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body?: string }) => {
        bodies.push(JSON.parse(opts.body!));
        return Promise.resolve({ ok: true, status: 200, body: sseStream([frame('done', {})]) });
      }) as unknown as typeof fetch,
    );
    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: 'hi' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].auto_model).toBe(false);
  });
});
