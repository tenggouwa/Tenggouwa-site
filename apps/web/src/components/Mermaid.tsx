import { useEffect, useRef, useState } from 'react';

// mermaid 体积大，动态 import 单独切 chunk，只有真出现 ```mermaid 代码块的文章才加载。
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
}

export default function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            fontFamily: 'JetBrains Mono, monospace',
            background: '#0b0f10',
            primaryColor: '#11181c',
            primaryTextColor: '#d4dadf',
            primaryBorderColor: '#5af78e',
            secondaryColor: '#16202a',
            tertiaryColor: '#0d1418',
            lineColor: '#57c7ff',
            textColor: '#d4dadf',
          },
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        return mermaid.render(id, chart);
      })
      .then((res) => {
        if (alive && res && ref.current) ref.current.innerHTML = res.svg;
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [chart]);

  if (error) {
    // 渲染失败时退回原始代码，不让整页崩
    return (
      <pre className="max-w-full overflow-x-auto">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center rounded-lg border border-terminal-line/50 bg-terminal-panel/20 p-4 [&_svg]:max-w-full"
    />
  );
}
