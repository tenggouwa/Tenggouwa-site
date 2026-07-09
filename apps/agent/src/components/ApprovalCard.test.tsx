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

  it('未决策不能执行；批准后回 { id: true }', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard requests={ONE} locked={false} onDecide={onDecide} />);
    const go = screen.getByText('↵ 执行') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByText('批准'));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onDecide).toHaveBeenCalledWith({ c1: true });
    expect(screen.getByText('已提交决策')).toBeTruthy();
  });

  it('拒绝后回 { id: false }（fail-closed 语义由后端兜底）', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard requests={ONE} locked={false} onDecide={onDecide} />);
    fireEvent.click(screen.getByText('拒绝'));
    fireEvent.click(screen.getByText('↵ 执行'));
    expect(onDecide).toHaveBeenCalledWith({ c1: false });
  });

  it('多工具：每个都要决策才能执行；全部批准一键设置', () => {
    const onDecide = vi.fn();
    const many: ApprovalRequest[] = [
      { id: 'a', name: 'shell_exec', args: {} },
      { id: 'b', name: 'file_write', args: { path: '/etc/hosts' } },
    ];
    render(<ApprovalCard requests={many} locked={false} onDecide={onDecide} />);
    const go = screen.getByText('↵ 执行') as HTMLButtonElement;
    fireEvent.click(screen.getByText('全部批准'));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onDecide).toHaveBeenCalledWith({ a: true, b: true });
  });

  it('单工具不显示全部批准/拒绝', () => {
    render(<ApprovalCard requests={ONE} locked={false} onDecide={() => {}} />);
    expect(screen.queryByText('全部批准')).toBeNull();
  });

  it('locked 时禁用、不显示执行按钮', () => {
    render(<ApprovalCard requests={ONE} locked onDecide={() => {}} />);
    expect(screen.queryByText('↵ 执行')).toBeNull();
    expect((screen.getByText('批准') as HTMLButtonElement).disabled).toBe(true);
  });
});
