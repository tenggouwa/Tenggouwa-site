// @vitest-environment happy-dom
//
// 冒烟渲染测试：把整个 <App/> 挂到 jsdom 里跑一遍。
// 目的是堵住 tsc / vite build / 纯函数 vitest 都抓不到的「运行时挂载崩溃」——
// 比如 react 与 react-dom 大版本错配（react@19 + react-dom@18 会抛
// `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')`）。
// 这类回归过去只能靠 deploy 后 Lighthouse NO_FCP 才发现，现在 CI 直接拦。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

beforeAll(() => {
  // 跳过 BootScreen 开机动画，直接进站
  window.sessionStorage.setItem('booted', '1');
  // 首页会打 /api/public/posts，给个空 envelope，避免未处理的网络拒绝
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0 }),
    }),
  );
});

afterEach(() => cleanup());

describe('App 冒烟渲染', () => {
  it('挂载首页画出 Layout（react/react-dom 错配会在这里直接崩）', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // footer 文案只有在 Layout 成功挂载后才出现
    expect(screen.getByText(/made with caffeine/i)).toBeTruthy();
  });

  it('能渲染非首页路由（/about）而不抛错', () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/made with caffeine/i).length).toBeGreaterThan(0);
  });
});
