// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AskPanel, { type AskQuestion } from './AskPanel';

afterEach(cleanup);

const Q1: AskQuestion[] = [{ header: '技能', question: '会写 Python 吗？', options: ['会', '不会'] }];

describe('AskPanel', () => {
  it('每题一组选项 + 追加「其他…」', () => {
    render(<AskPanel questions={Q1} locked={false} onSubmit={() => {}} />);
    expect(screen.getByText('会')).toBeTruthy();
    expect(screen.getByText('不会')).toBeTruthy();
    expect(screen.getByText('其他…')).toBeTruthy();
  });

  it('未答完不能发送；选了才行', () => {
    const onSubmit = vi.fn();
    render(<AskPanel questions={Q1} locked={false} onSubmit={onSubmit} />);
    const send = screen.getByText('↵ 发送选择') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByText('会'));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith('技能：会');
    expect(screen.getByText('已提交')).toBeTruthy();
  });

  it('选「其他…」展开输入框，用输入文本替换哨兵', () => {
    const onSubmit = vi.fn();
    render(<AskPanel questions={Q1} locked={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('其他…'));
    const input = screen.getByPlaceholderText('输入你的答案…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Rust' } });
    fireEvent.click(screen.getByText('↵ 发送选择'));
    expect(onSubmit).toHaveBeenCalledWith('技能：Rust');
  });

  it('选「其他…」但没填 → 仍不能发送', () => {
    render(<AskPanel questions={Q1} locked={false} onSubmit={() => {}} />);
    fireEvent.click(screen.getByText('其他…'));
    expect((screen.getByText('↵ 发送选择') as HTMLButtonElement).disabled).toBe(true);
  });

  it('locked 时禁用、不显示发送按钮', () => {
    render(<AskPanel questions={Q1} locked onSubmit={() => {}} />);
    expect(screen.queryByText('↵ 发送选择')).toBeNull();
    expect((screen.getByText('会') as HTMLButtonElement).disabled).toBe(true);
  });

  it('多题：各选一个，组成多行回答', () => {
    const onSubmit = vi.fn();
    const qs: AskQuestion[] = [
      { header: '环境', question: 'q1', options: ['VPS', 'Actions'] },
      { header: '推送', question: 'q2', options: ['TG', '邮件'] },
    ];
    render(<AskPanel questions={qs} locked={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByText('TG'));
    fireEvent.click(screen.getByText('↵ 发送选择'));
    expect(onSubmit).toHaveBeenCalledWith('环境：Actions\n推送：TG');
  });
});
