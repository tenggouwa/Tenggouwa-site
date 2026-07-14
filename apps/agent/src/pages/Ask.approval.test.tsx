// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Ask from './Ask';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

// 完整审批闭环（页面级）：首个流暂停发 approval → 用户批准 → 续跑流带 approvals 回后端。
describe('Ask approval flow', () => {
  it('approval 事件渲染审批卡；批准后 resume 请求带 { approvals, session_id }', async () => {
    const first = [
      frame('session', { type: 'session', session_id: 's1' }),
      frame('token', { type: 'token', delta: '我准备执行删除' }),
      frame('approval', {
        type: 'approval',
        requests: [{ id: 'c1', name: 'shell_exec', args: { cmd: 'rm x' } }],
      }),
      frame('done', { type: 'done' }),
    ];
    const second = [
      frame('session', { type: 'session', session_id: 's1' }),
      frame('tool', { type: 'tool', name: 'shell_exec', args: { cmd: 'rm x' } }),
      frame('token', { type: 'token', delta: '已删除。' }),
      frame('done', { type: 'done' }),
    ];

    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, body: sseStream(bodies.length === 1 ? first : second) });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/问一个问题/), { target: { value: '删掉 x' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    // 暂停：审批卡出现，preamble 已流出
    await waitFor(() => expect(screen.getByText('shell_exec')).toBeTruthy());
    expect(screen.getByText('我准备执行删除')).toBeTruthy();

    // 一键批准（点批准即执行，无二次确认）
    fireEvent.click(screen.getByText('批准'));

    // 续跑 token 接在 preamble 后（同一轮 answer 拼接）
    await waitFor(() => expect(screen.getByText(/已删除。/)).toBeTruthy());

    // 首个请求带 q；续跑请求带 approvals + 同一 session_id（公开模式 auto_approve=false）
    expect(bodies[0]).toEqual({ q: '删掉 x', session_id: null, auto_approve: false });
    expect(bodies[1]).toEqual({ approvals: { c1: true }, session_id: 's1', auto_approve: false });
    expect(screen.queryByText('批准')).toBeNull(); // 审批卡已消费收起
  });

  it('多步：续跑再抛 approval → 弹全新可操作的审批卡（不被上轮 submitted 锁死）', async () => {
    const first = [
      frame('session', { type: 'session', session_id: 's1' }),
      frame('approval', { type: 'approval', requests: [{ id: 'c1', name: 'shell_exec', args: {} }] }),
      frame('done', { type: 'done' }),
    ];
    // 续跑 c1 后模型又要执行 file_write（另一次 write）→ 再次暂停
    const second = [
      frame('tool', { type: 'tool', name: 'shell_exec', args: {} }),
      frame('approval', { type: 'approval', requests: [{ id: 'c2', name: 'file_write', args: { path: '/etc/hosts' } }] }),
      frame('done', { type: 'done' }),
    ];
    const third = [frame('token', { type: 'token', delta: '全部完成。' }), frame('done', { type: 'done' })];

    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      const frames = bodies.length === 1 ? first : bodies.length === 2 ? second : third;
      return Promise.resolve({ ok: true, body: sseStream(frames) });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<Ask />);
    fireEvent.change(screen.getByPlaceholderText(/问一个问题/), { target: { value: '搞一批操作' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    // 第 1 张卡（c1）→ 一键批准
    await waitFor(() => expect(screen.getByText('shell_exec')).toBeTruthy());
    fireEvent.click(screen.getByText('批准'));

    // 第 2 张卡（c2）：全新、可操作（不被上轮 submitted 锁死）→ 再一键批准
    await waitFor(() => expect(screen.getByText('file_write')).toBeTruthy());
    fireEvent.click(screen.getByText('批准'));

    await waitFor(() => expect(screen.getByText(/全部完成。/)).toBeTruthy());
    // 三次请求：q → approvals c1 → approvals c2，session_id 始终一致
    expect(bodies[1]).toEqual({ approvals: { c1: true }, session_id: 's1', auto_approve: false });
    expect(bodies[2]).toEqual({ approvals: { c2: true }, session_id: 's1', auto_approve: false });
  });
});
