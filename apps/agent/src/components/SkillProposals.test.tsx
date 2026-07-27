// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SkillProposals from './SkillProposals';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

const PROPS = [
  { id: 1, name: 'send_email', description: '给指定地址发邮件', parameters: {}, rationale: '用户要发通知但没有邮件工具', created_at: '2026-07-25T02:00:00' },
];

describe('SkillProposals 技能提案面板', () => {
  it('列出提案（名字/用途/缺口），✕ 删乐观移除 + 打 DELETE', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || 'GET' });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env(PROPS)) });
      }) as unknown as typeof fetch,
    );
    render(<SkillProposals token="t" />);
    await waitFor(() => expect(screen.getByText('send_email')).toBeTruthy());
    expect(screen.getByText('给指定地址发邮件')).toBeTruthy();
    expect(screen.getByText(/用户要发通知但没有邮件工具/)).toBeTruthy();

    fireEvent.click(screen.getByTitle('删掉这条提案'));
    await waitFor(() => expect(screen.queryByText('send_email')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/skill-proposals/1'))).toBe(true);
  });

  it('没提案时不渲染（不占侧栏）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env([])) })) as unknown as typeof fetch,
    );
    const { container } = render(<SkillProposals token="t" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
