// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Arch from './Arch';

afterEach(cleanup);

describe('Arch 架构解剖器（原地下钻）', () => {
  it('根渲染分层总图的顶层节点', () => {
    render(<Arch />);
    expect(screen.getByText('编排循环 Agent Loop')).toBeTruthy();
    expect(screen.getByText('记忆 Memory')).toBeTruthy();
    expect(screen.getByText('安全 / 权限 / 沙箱')).toBeTruthy();
  });

  it('点节点 → 原地钻进去（替换总图），显示概念/我的实现/二级方块', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('记忆 Memory'));
    await waitFor(() => expect(screen.getByText(/越用越懂你/)).toBeTruthy());
    expect(screen.getByText('概念 · 最新做法')).toBeTruthy();
    expect(screen.getByText('我的实现')).toBeTruthy();
    // 二级架构方块（和一层一样的 NodeBox）
    expect(screen.getByText('召回 recall + 注入')).toBeTruthy();
    // 是"替换"不是"叠加"：其它顶层节点已不在视图里
    expect(screen.queryByText('编排循环 Agent Loop')).toBeNull();
  });

  it('点二级方块 → 继续下钻，面包屑增长、内容替换', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('记忆 Memory'));
    await waitFor(() => expect(screen.getByText('召回 recall + 注入')).toBeTruthy());
    fireEvent.click(screen.getByText('召回 recall + 注入'));
    // recall 的内容替换进来（RECALL_MAX_DISTANCE 只在 recall 里出现）
    await waitFor(() => expect(screen.getAllByText(/RECALL_MAX_DISTANCE/).length).toBeGreaterThan(0));
    // 记忆自己的 summary 已被替换掉
    expect(screen.queryByText(/越用越懂你/)).toBeNull();
  });

  it('P2 节点(RAG)也能钻进去看二级', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('RAG / 知识'));
    await waitFor(() => expect(screen.getByText('混合检索 RRF 2:1')).toBeTruthy());
    expect(screen.getByText('GraphRAG 概念图谱')).toBeTruthy();
  });

  it('节点展示真实代码块', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('能力层 Tools / Skills'));
    // Skill dataclass 真代码
    await waitFor(() => expect(screen.getByText(/代码 · base\.py/)).toBeTruthy());
    expect(screen.getByText(/risk: Literal\["readonly", "write"\]/)).toBeTruthy();
  });

  it('节点展示数据流走查 + 坑/教训', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('编排循环 Agent Loop'));
    await waitFor(() => expect(screen.getByText('数据流走查')).toBeTruthy());
    expect(screen.getByText('⚠ 坑 · 教训')).toBeTruthy();
    expect(screen.getAllByText(/会话毒化/).length).toBeGreaterThan(0);
  });

  it('面包屑 ~/arch 回到根总图', async () => {
    render(<Arch />);
    fireEvent.click(screen.getByText('安全 / 权限 / 沙箱'));
    await waitFor(() => expect(screen.queryByText('编排循环 Agent Loop')).toBeNull());
    fireEvent.click(screen.getByText('~/arch'));
    await waitFor(() => expect(screen.getByText('编排循环 Agent Loop')).toBeTruthy());
  });
});
