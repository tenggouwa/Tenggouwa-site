// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { isTableSep, renderMarkdown, splitRow } from './markdown';

afterEach(cleanup);

function html(md: string): HTMLElement {
  const { container } = render(<div>{renderMarkdown(md)}</div>);
  return container;
}

describe('splitRow / isTableSep（纯函数）', () => {
  it('splitRow 去掉首尾空段', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });

  it('isTableSep 认 ASCII - 与全角 —，带/不带冒号', () => {
    expect(isTableSep('|---|---|')).toBe(true);
    expect(isTableSep('| :--- | ---: |')).toBe(true);
    expect(isTableSep('|——|——|')).toBe(true); // 全角
    expect(isTableSep('| 步骤 | 工具 |')).toBe(false); // 正常表头行
    expect(isTableSep('a < b')).toBe(false); // 无 |
  });
});

describe('renderMarkdown 表格', () => {
  const md = `| 步骤 | 工具 |
|------|------|
| 抓取 | [nitter](https://nitter.net) |
| 推送 | Server酱 |`;

  it('渲染成 <table>，表头与单元格正确', () => {
    const c = html(md);
    const table = c.querySelector('table');
    expect(table).not.toBeNull();
    expect([...c.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['步骤', '工具']);
    const firstRow = [...c.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((td) => td.textContent);
    expect(firstRow[0]).toBe('抓取');
  });

  it('单元格内的 markdown 链接渲染成 <a>', () => {
    const c = html(md);
    const a = c.querySelector('tbody a');
    expect(a?.getAttribute('href')).toBe('https://nitter.net');
    expect(a?.textContent).toBe('nitter');
  });

  it('不会把表格竖线当纯文本漏出来', () => {
    const c = html(md);
    // 表头/分隔行的原始 | 不应作为文本节点直接出现在最外层
    expect(c.textContent).not.toContain('|------|');
  });
});

describe('renderMarkdown 代码块', () => {
  it('```lang 渲染成 <pre><code> + 语言标签 + 复制按钮', () => {
    const c = html('```python\nprint(1)\n```');
    const pre = c.querySelector('pre code');
    expect(pre?.textContent).toBe('print(1)');
    expect(c.textContent).toContain('python');
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === '复制')).toBe(true);
  });

  it('流式未闭合的 ``` 也渲染成代码块，不露出裸 ```', () => {
    const c = html('前言\n```js\nconst a =');
    expect(c.querySelector('pre')).not.toBeNull();
    expect(c.textContent).not.toContain('```');
  });
});

describe('renderMarkdown 行内 + 标题 + 分隔', () => {
  it('**粗** / `代码` / [链接]', () => {
    const c = html('这是 **重点** 和 `code` 和 [站点](https://x.com)。');
    expect(c.querySelector('strong')?.textContent).toBe('重点');
    expect(c.querySelector('code')?.textContent).toBe('code');
    expect(c.querySelector('a')?.getAttribute('href')).toBe('https://x.com');
  });

  it('## 标题不露出 ## 前缀', () => {
    const c = html('## 具体实现');
    expect(c.textContent).toContain('具体实现');
    expect(c.textContent).not.toContain('##');
  });

  it('--- 渲染成 <hr>', () => {
    expect(html('上\n\n---\n\n下').querySelector('hr')).not.toBeNull();
  });

  it('非 http 链接不渲染成 <a>（安全）', () => {
    const c = html('[x](javascript:alert(1))');
    expect(c.querySelector('a')).toBeNull();
  });

  it('站内绝对路径 /… 链接（回引用来源）渲染成 <a>，新标签打开', () => {
    const a = html('见 [《VPS 调优》](/posts/vps/)。').querySelector('a');
    expect(a?.getAttribute('href')).toBe('/posts/vps/');
    expect(a?.getAttribute('target')).toBe('_blank');
  });

  it('相对路径（不以 / 开头）不渲染成 <a>（避免误伤）', () => {
    expect(html('[x](posts/vps)').querySelector('a')).toBeNull();
  });
});
