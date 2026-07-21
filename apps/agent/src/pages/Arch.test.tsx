// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Arch from './Arch';

afterEach(cleanup);

describe('Arch 架构解剖器', () => {
  it('渲染分层主图的顶层节点', () => {
    render(<Arch />);
    expect(screen.getByText('编排循环 Agent Loop')).toBeTruthy();
    expect(screen.getByText('记忆 Memory')).toBeTruthy();
    expect(screen.getByText('安全 / 权限 / 沙箱')).toBeTruthy();
  });

  it('点核心节点 → 抽屉打开，显示概念/我的实现/二级架构', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('记忆 Memory'));
    // 抽屉里的 summary（唯一，区别于图上的标题）
    await waitFor(() => expect(screen.getByText(/越用越懂你/)).toBeTruthy());
    expect(screen.getByText('概念 · 最新做法')).toBeTruthy();
    expect(screen.getByText('我的实现')).toBeTruthy();
    // 二级架构卡片
    expect(screen.getByText('召回 recall + 注入')).toBeTruthy();
  });

  it('点二级节点 → 下钻，面包屑增长', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('记忆 Memory'));
    await waitFor(() => expect(screen.getByText('召回 recall + 注入')).toBeTruthy());
    fireEvent.click(screen.getByText('召回 recall + 注入'));
    // 面包屑出现 ~/arch / 记忆 Memory / 召回...
    const bar = screen.getByText('~/arch').closest('div')!;
    await waitFor(() => expect(within(bar).getByText('召回 recall + 注入')).toBeTruthy());
  });

  it('✕ 关闭抽屉', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('编排循环 Agent Loop'));
    await waitFor(() => expect(screen.getByText(/整套 agent 的心脏/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText('关闭'));
    await waitFor(() => expect(screen.queryByText(/整套 agent 的心脏/)).toBeNull());
  });
});
