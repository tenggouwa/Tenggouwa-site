// M1 占位壳。M2 会接后端只读接口，展示：数据源、文档列表、chunk 数、reindex 触发、块浏览。

export default function KnowledgeBase() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>knowledge-base
        </h1>
        <p className="text-sm text-terminal-gray/70">
          agent 的知识来源。这里管理/浏览知识库本身——数据源、文档、分块、重建索引。
        </p>
      </div>

      <div className="rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-5 space-y-3">
        <div className="text-sm text-terminal-gray/85">已接入的源：</div>
        <ul className="text-sm space-y-1 text-terminal-gray/85">
          <li>
            <span className="text-terminal-green">blog</span>
            <span className="text-terminal-gray/50"> —— 站内文章（正文分块 + 向量嵌入）</span>
          </li>
          <li className="text-terminal-gray/40">notes / code / web —— 计划中</li>
        </ul>
      </div>

      <div className="rounded-lg border border-terminal-line/60 bg-terminal-bg/40 p-8 text-center text-sm text-terminal-gray/50">
        <span className="text-terminal-green">// TODO(M2)</span> 接后端只读接口：文档列表、chunk 数、最近重建时间、reindex 按钮、块内容浏览。
      </div>
    </div>
  );
}
