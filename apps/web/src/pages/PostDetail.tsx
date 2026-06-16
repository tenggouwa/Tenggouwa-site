import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Tag, Message } from '@arco-design/web-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import ReadingProgress from '../components/ReadingProgress';
import OdometerCount from '../components/OdometerCount';
import CodeBlock from '../components/CodeBlock';
import TableOfContents from '../components/TableOfContents';
import RelatedPosts from '../components/RelatedPosts';
import SeriesNav from '../components/SeriesNav';
import { estimateReadingMinutes } from '../lib/reading';
import { seriesForTags } from '../lib/series';
import type { Post } from '../lib/types';

export default function PostDetail() {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [reads, setReads] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 复制纯 markdown 给 LLM 用。优先 fetch 预渲染的 /posts/<slug>.md（带 H1 +
  // 元数据头，LLM 友好）；dev 环境或 prerender 缺失时回落到 post.content。
  async function copyMarkdown() {
    if (!post) return;
    let text = '';
    try {
      const r = await fetch(`/posts/${post.slug}.md`);
      if (r.ok) {
        const body = await r.text();
        // 防 dev / SPA 兜底把 .md 路径回退成 index.html
        if (body && !/^\s*<!doctype/i.test(body) && !/^\s*<html/i.test(body)) {
          text = body;
        }
      }
    } catch {
      /* swallow, fallback below */
    }
    if (!text) text = `# ${post.title}\n\n${post.content}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      Message.success({ content: '已复制 markdown · 喂给 ChatGPT/Claude 用', duration: 2500 });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      Message.error('复制失败：浏览器拒绝了 clipboard 权限');
    }
  }

  useEffect(() => {
    if (!slug) return;
    setPost(null);
    setError(null);
    apiGet<Post>(`/api/public/posts/${slug}`)
      .then(setPost)
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    setReads(null);
    apiGet<{ views: number }>(`/api/public/track/views?path=/posts/${slug}`)
      .then((d) => setReads(d.views))
      .catch(() => {});
  }, [slug]);

  const minutes = useMemo(
    () => (post ? estimateReadingMinutes(post.content) : 0),
    [post],
  );
  const series = useMemo(
    () => (post ? seriesForTags(post.tags) : null),
    [post],
  );

  if (error) {
    return (
      <div className="text-red-400">
        <span className="text-terminal-pink">err: </span>
        {error}
        <div className="mt-4">
          <Link to="/posts" className="text-terminal-cyan hover:underline">
            ← cd ../posts
          </Link>
        </div>
      </div>
    );
  }

  if (!post) {
    return <TermLoading tip={['resolving slug...', 'fetching markdown...', 'rendering...']} />;
  }

  return (
    <>
      <ReadingProgress />
      <TableOfContents containerSelector="#post-body" />
      <article className="space-y-6 min-w-0 overflow-x-clip">
        <Link to="/posts" className="text-xs text-terminal-cyan hover:underline">
          ← cd ../posts
        </Link>
        <header className="space-y-2 border-b border-terminal-line/60 pb-4">
          {series && (
            <Link
              to={`/series/${series.tag}`}
              className="inline-flex items-center gap-1 text-xs text-terminal-cyan
                         hover:text-terminal-green transition-colors"
            >
              <span className="text-terminal-pink">~$</span>
              <span>cd ../{series.tag}</span>
            </Link>
          )}
          <h1 className="text-2xl text-terminal-green">{post.title}</h1>
          <div className="text-xs text-terminal-gray/80 flex items-center gap-3 flex-wrap">
            <span>{post.published_at.slice(0, 10)}</span>
            <span className="text-terminal-gray/40">·</span>
            <span>{minutes} min read</span>
            {reads != null && reads > 0 && (
              <>
                <span className="text-terminal-gray/40">·</span>
                <span className="inline-flex items-baseline gap-1 tabular-nums">
                  <span className="text-terminal-gray/50">reads</span>
                  <span className="text-terminal-gray/40">[</span>
                  <OdometerCount
                    value={reads}
                    className="text-terminal-green tracking-wider [text-shadow:0_0_8px_rgba(90,247,142,0.45)]"
                  />
                  <span className="text-terminal-gray/40">]</span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-2 flex-wrap">
              {post.tags.map((t) => (
                <Tag key={t} color="green" size="small">
                  {t}
                </Tag>
              ))}
            </div>
            <button
              type="button"
              onClick={copyMarkdown}
              title="复制纯 markdown，粘进 ChatGPT / Claude 让它帮你总结、出题、翻译"
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-terminal-line/60
                         bg-terminal-panel/30 px-2 py-1 font-mono text-[11px] text-terminal-gray
                         hover:border-terminal-green/60 hover:text-terminal-green
                         transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {copied ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </svg>
              <span>{copied ? 'copied!' : '$ copy --markdown'}</span>
            </button>
          </div>
        </header>
        <div id="post-body" className="prose prose-invert max-w-none min-w-0 break-words">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={{ pre: CodeBlock }}
          >
            {post.content}
          </ReactMarkdown>
        </div>
        {series && <SeriesNav tag={series.tag} currentSlug={post.slug} />}
        <RelatedPosts slug={post.slug} />
      </article>
    </>
  );
}
