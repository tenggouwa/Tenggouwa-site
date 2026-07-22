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

describe('Ask 反思', () => {
  it('开启后请求带 reflect:true；revise 事件把初稿收进过程、改写成为最终答案', async () => {
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
            frame('token', { delta: '初稿内容' }), // 草稿流式
            frame('reflect', { round: 1, verdict: 'revise', critique: '少了复杂度分析' }),
            frame('token', { delta: '改写后的答案' }), // 改写流式（answer 已被清空）
            frame('reflect', { round: 2, verdict: 'pass', critique: 'PASS' }),
            frame('done', {}),
          ]),
        });
      }) as unknown as typeof fetch,
    );

    render(<Ask />);
    fireEvent.click(screen.getByText(/反思/)); // 开启
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: '写个快排' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);

    // 最终可见答案 = 改写版
    await waitFor(() => expect(screen.getByText('改写后的答案')).toBeTruthy());
    expect(bodies[0].reflect).toBe(true);
    // 反思过程折叠块：初稿 + 评审都在
    expect(screen.getByText('🔍 反思过程 · 2 轮自评')).toBeTruthy();
    expect(screen.getByText('初稿内容')).toBeTruthy(); // 初稿被收进过程
    expect(screen.getByText('少了复杂度分析')).toBeTruthy(); // 评审意见
  });

  it('默认关闭时 reflect:false', async () => {
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
    expect(bodies[0].reflect).toBe(false);
  });
});
