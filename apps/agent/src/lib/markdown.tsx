import { useState } from 'react';

// 轻量安全的行内 markdown：**粗体** / `代码` / [文字](链接)。用 React 节点拼装（不注入 HTML），
// 无 XSS 风险；流式时未闭合的 ** 先按原文显示，闭合后变粗体。链接只放行 http(s)。
export function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="text-terminal-green font-semibold">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <code key={key++} className="text-terminal-cyan bg-terminal-panel/60 px-1 rounded">
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={m[4]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-terminal-cyan underline decoration-dotted hover:text-terminal-green"
        >
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// 代码块：```lang\n...``` → 带语言标签 + 右上角复制按钮的等宽块。
// 最大高度 max-h-80，超出纵向滚动，不无限拉长；横向也可滚。
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="my-2 rounded border border-terminal-line/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 text-[11px] border-b border-terminal-line/40 bg-terminal-panel/40">
        <span className="text-terminal-gray/50">{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="text-terminal-gray/60 hover:text-terminal-green transition-colors"
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-2 max-h-80 overflow-auto text-xs leading-relaxed text-terminal-cyan bg-terminal-bg/60">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// 拆一行为单元格，去掉首尾空段（| a | b | → [a, b]）
export function splitRow(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// markdown 表格分隔行：|---|:--:|---|。每格都是 (可选:) 一串横线 (可选:)，兼容 ASCII - 与全角 —。
export function isTableSep(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?[-—]+:?$/.test(c));
}

function Table({ header, rows, k }: { header: string[]; rows: string[][]; k: number }) {
  return (
    <div key={`tb${k}`} className="my-2 overflow-x-auto">
      <table className="text-xs border-collapse border border-terminal-line/60">
        <thead>
          <tr>
            {header.map((h, j) => (
              <th
                key={j}
                className="border border-terminal-line/50 px-2 py-1 text-left text-terminal-green font-semibold whitespace-nowrap"
              >
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border border-terminal-line/40 px-2 py-1 align-top text-terminal-gray/90">
                  {renderInline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 文本段（非代码块）：逐行渲染，识别表格 / # 标题 / --- 分隔 / 空行，其余走行内 markdown。
function renderTextBlock(seg: string): React.ReactElement[] {
  const lines = seg.split('\n');
  const out: React.ReactElement[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 表格：当前行含 |，下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(<Table key={`tb${i}`} k={i} header={header} rows={rows} />);
      continue;
    }
    if (line.trim() === '') {
      out.push(<div key={i} className="h-2" />);
    } else if (/^\s*(-{3,}|—{3,})\s*$/.test(line)) {
      out.push(<hr key={i} className="my-2 border-terminal-line/40" />);
    } else {
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        const big = h[1].length <= 2;
        out.push(
          <div
            key={i}
            className={big ? 'text-terminal-green font-semibold mt-2 mb-0.5' : 'text-terminal-cyan font-semibold mt-1.5'}
          >
            {renderInline(h[2])}
          </div>,
        );
      } else {
        out.push(
          <div key={i} className="leading-relaxed">
            {renderInline(line)}
          </div>,
        );
      }
    }
    i += 1;
  }
  return out;
}

// 块级 markdown：按 ``` 切成 文本/代码 交替段（奇数段=代码块）。天然兜住流式未闭合的代码块。
export function renderMarkdown(text: string): React.ReactElement[] {
  return text.split('```').flatMap((seg, i): React.ReactElement[] => {
    if (i % 2 === 1) {
      const nl = seg.indexOf('\n');
      const lang = nl < 0 ? seg.trim() : seg.slice(0, nl).trim();
      const code = nl < 0 ? '' : seg.slice(nl + 1).replace(/\n$/, '');
      return [<CodeBlock key={`c${i}`} lang={lang} code={code} />];
    }
    return seg ? renderTextBlock(seg) : [];
  });
}
