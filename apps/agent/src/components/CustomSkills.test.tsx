// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomSkills from './CustomSkills';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const env = <T,>(data: T) => ({ code: 0, message: '', data });

describe('CustomSkills 自定义技能', () => {
  it('列出已有 + 建 prompt 型时提交正确 body（参数由逗号名生成 schema）', async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posts.push(JSON.parse(init.body as string));
        const body =
          init?.method === 'POST'
            ? env({ ok: true, message: '（已新建自定义 skill「translate」。）' })
            : env([{ id: 1, name: 'greet', description: '打招呼', parameters: {}, kind: 'prompt', config: {}, enabled: true, created_at: '2026-07-26T02:00:00' }]);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }) as unknown as typeof fetch,
    );

    render(<CustomSkills token="t" />);
    await waitFor(() => expect(screen.getByText('greet')).toBeTruthy()); // 已有列表

    fireEvent.change(screen.getByPlaceholderText(/name/), { target: { value: 'translate' } });
    fireEvent.change(screen.getByPlaceholderText(/description/), { target: { value: '翻译' } });
    fireEvent.change(screen.getByPlaceholderText(/参数名，逗号/), { target: { value: 'text, lang' } });
    fireEvent.change(screen.getByPlaceholderText(/提示词模板/), { target: { value: '把 {text} 翻成 {lang}' } });
    fireEvent.click(screen.getByText(/加 \/ 更新/));

    await waitFor(() => expect(posts.length).toBe(1));
    const b = posts[0] as { kind: string; parameters: { required: string[] }; config: { template: string } };
    expect(b.kind).toBe('prompt');
    expect(b.parameters.required).toEqual(['text', 'lang']); // 逗号名 → schema.required
    expect(b.config.template).toContain('{text}');
    await waitFor(() => expect(screen.getByText(/已新建/)).toBeTruthy());
  });

  it('切到 http 型时出现 URL + 方法字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(env([])) })) as unknown as typeof fetch,
    );
    render(<CustomSkills token="t" />);
    // prompt 态只有一个 select（kind），切成 http
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'http' } });
    await waitFor(() => expect(screen.getByPlaceholderText(/https/)).toBeTruthy());
  });
});
