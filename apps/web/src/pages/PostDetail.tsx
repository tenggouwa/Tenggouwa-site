import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Tag } from '@arco-design/web-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { apiGet } from '../lib/api';
import TermLoading from '../components/TermLoading';
import ReadingProgress from '../components/ReadingProgress';
import CodeBlock from '../components/CodeBlock';
import TableOfContents from '../components/TableOfContents';
import RelatedPosts from '../components/RelatedPosts';
import { estimateReadingMinutes } from '../lib/reading';
import { seriesForTags } from '../lib/series';
import type { Post } from '../lib/types';

export default function PostDetail() {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setPost(null);
    setError(null);
    apiGet<Post>(`/api/public/posts/${slug}`)
      .then(setPost)
      .catch((e: Error) => setError(e.message));
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
          </div>
          <div className="flex gap-2 flex-wrap">
            {post.tags.map((t) => (
              <Tag key={t} color="green" size="small">
                {t}
              </Tag>
            ))}
          </div>
        </header>
        <div id="post-body" className="prose prose-invert max-w-none min-w-0 break-words">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: CodeBlock }}
          >
            {post.content}
          </ReactMarkdown>
        </div>
        <RelatedPosts slug={post.slug} />
      </article>
    </>
  );
}
