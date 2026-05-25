import { useState, type ReactNode } from 'react';

// 给 react-markdown 用的 <pre> 替换组件：保留 highlight 结果，hover 出现复制按钮
// react-markdown v9 的 components.pre 接到的是 {node, children, ...rest}，children
// 是一个 <code> 元素（带 hljs 的 className 和高亮 span）

interface PreProps {
  children?: ReactNode;
  className?: string;
}

export default function CodeBlock({ children, className }: PreProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = extractText(children);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard 不可用就 fallback：select range（罕见）
    }
  };

  return (
    <pre className={`group relative ${className ?? ''}`}>
      {children}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'copied' : 'copy'}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity
                   flex items-center gap-1 px-1.5 py-1 rounded
                   border border-terminal-line/60 bg-terminal-bg/80
                   text-terminal-gray hover:text-terminal-green hover:border-terminal-green/60
                   text-[11px] font-mono"
      >
        {copied ? (
          <>
            <CheckIcon /> copied
          </>
        ) : (
          <>
            <CopyIcon /> copy
          </>
        )}
      </button>
    </pre>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// 把 react-markdown 给的 children（可能是数组的元素树）拍平成纯文本
function extractText(node: ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    // ReactElement
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}
