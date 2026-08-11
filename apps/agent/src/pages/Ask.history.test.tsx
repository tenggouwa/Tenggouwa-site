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

function stubChat() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: sseStream([frame('session', { session_id: 's1' }), frame('token', { delta: 'ok' }), frame('done', {})]),
    }),
  );
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
}

describe('Ask 输入历史持久化', () => {
  it('提交后写入 localStorage，并去重相邻重复', async () => {
    stubChat();
    render(<Ask />);
    const ta = screen.getByPlaceholderText(/回车发送/);
    fireEvent.change(ta, { target: { value: '第一条' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('agent_input_history') || '[]')).toEqual(['第一条']));
  });

  it('重开（重新挂载）后 ↑ 能翻出上次输入', async () => {
    localStorage.setItem('agent_input_history', JSON.stringify(['旧问题']));
    stubChat();
    render(<Ask />);
    const ta = screen.getByPlaceholderText(/回车发送/) as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    await waitFor(() => expect(ta.value).toBe('旧问题'));
  });

  it('收口状态对用户可见，并在完成时去掉流式残留的孤立尖括号', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: sseStream([
          frame('status', { message: '已获取 4 个外部来源，正在基于现有资料收口。' }),
          frame('token', { delta: '结论<' }),
          frame('done', {}),
        ]),
      }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/回车发送/), { target: { value: '查一下' } });
    fireEvent.submit(document.querySelector('form:last-of-type') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText(/已获取 4 个外部来源/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('结论')).toBeTruthy());
    expect(screen.queryByText('结论<')).toBeNull();
  });
});
