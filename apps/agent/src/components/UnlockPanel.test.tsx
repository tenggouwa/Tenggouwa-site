// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UnlockPanel from './UnlockPanel';

afterEach(cleanup);

const codeInput = () => screen.getByPlaceholderText('6 位 TOTP 码') as HTMLInputElement;

describe('UnlockPanel', () => {
  it('未满 6 位不能解锁；满 6 位提交回码', () => {
    const onSubmit = vi.fn();
    render(<UnlockPanel busy={false} onSubmit={onSubmit} />);
    const btn = screen.getByText('↵ 解锁') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('只保留数字、截断到 6 位', () => {
    render(<UnlockPanel busy={false} onSubmit={() => {}} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: '1a2b3c4d5e6f7g8' } });
    expect(input.value).toBe('123456'); // 只留数字并截断到 6
  });

  it('busy 时禁用输入与按钮、显示解锁中', () => {
    render(<UnlockPanel busy onSubmit={() => {}} />);
    expect(codeInput().disabled).toBe(true);
    expect(screen.getByText('解锁中…')).toBeTruthy();
  });

  it('展示后端错误文案', () => {
    render(<UnlockPanel busy={false} error="验证码错误" onSubmit={() => {}} />);
    expect(screen.getByText('验证码错误')).toBeTruthy();
  });
});
