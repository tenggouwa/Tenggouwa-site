// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ApprovalCard, { type ApprovalRequest } from './ApprovalCard';

afterEach(cleanup);

const ONE: ApprovalRequest[] = [{ id: 'c1', name: 'shell_exec', args: { cmd: 'rm -rf /tmp/x' } }];

describe('ApprovalCard', () => {
  it('渲染工具名 + 参数 + 批准/拒绝按钮', () => {
    render(<ApprovalCard requests={ONE} locked={false} onDecide={() => {}} />);
    expect(screen.getByText('shell_exec')).toBeTruthy();
    expect(screen.getByText(/cmd="rm -rf \/tmp\/x"/)).toBeTruthy();
    expect(screen.getByText('批准')).toBeTruthy();
    expect(screen.getByText('拒绝')).toBeTruthy();
  });

  it('单工具点批准即执行（一键，无二次确认）→ 回 { id: true }', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard requests={ONE} locked={false} onDecide={onDecide} />);
    fireEvent.click(screen.getByText('批准'));
    expect(onDecide).toHaveBeenCalledWith({ c1: true });
    expect(screen.getByText('已提交决策')).toBeTruthy();
    expect(screen.queryByText('↵ 执行')).toBeNull(); // 没有二次执行按钮
  });

  it('单工具点拒绝即回 { id: false }', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard requests={ONE} locked={false} onDecide={onDecide} />);
    fireEvent.click(screen.getByText('拒绝'));
    expect(onDecide).toHaveBeenCalledWith({ c1: false });
  });

  it('多工具：全部定完才提交；逐个点', () => {
    const onDecide = vi.fn();
    const many: ApprovalRequest[] = [
      { id: 'a', name: 'shell_exec', args: {} },
      { id: 'b', name: 'file_write', args: { path: '/etc/hosts' } },
    ];
    render(<ApprovalCard requests={many} locked={false} onDecide={onDecide} />);
    fireEvent.click(screen.getAllByText('批准')[0]); // 只定了 a，未提交
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText('拒绝')[1]); // b 也定了 → 提交
    expect(onDecide).toHaveBeenCalledWith({ a: true, b: false });
  });

  it('多工具：全部批准一键提交', () => {
    const onDecide = vi.fn();
    const many: ApprovalRequest[] = [
      { id: 'a', name: 'shell_exec', args: {} },
      { id: 'b', name: 'file_write', args: {} },
    ];
    render(<ApprovalCard requests={many} locked={false} onDecide={onDecide} />);
    fireEvent.click(screen.getByText('全部批准'));
    expect(onDecide).toHaveBeenCalledWith({ a: true, b: true });
  });

  it('单工具不显示全部批准/拒绝', () => {
    render(<ApprovalCard requests={ONE} locked={false} onDecide={() => {}} />);
    expect(screen.queryByText('全部批准')).toBeNull();
  });

  it('locked 时按钮禁用', () => {
    render(<ApprovalCard requests={ONE} locked onDecide={() => {}} />);
    expect((screen.getByText('批准') as HTMLButtonElement).disabled).toBe(true);
  });
});
