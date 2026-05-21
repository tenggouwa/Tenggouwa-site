import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Spin, Tag } from '@arco-design/web-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { apiGet } from '../lib/api';
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
    return (
      <div className="py-20 text-center">
        <Spin tip="加载中..." />
      </div>
    );
  }

  return (
    <article className="space-y-6">
      <Link to="/posts" className="text-xs text-terminal-cyan hover:underline">
        ← cd ../posts
      </Link>
      <header className="space-y-2 border-b border-terminal-line/60 pb-4">
        <h1 className="text-2xl text-terminal-green">{post.title}</h1>
        <div className="text-xs text-terminal-gray/80">
          {post.published_at.slice(0, 10)}
        </div>
        <div className="flex gap-2 flex-wrap">
          {post.tags.map((t) => (
            <Tag key={t} color="green" size="small">
              {t}
            </Tag>
          ))}
        </div>
      </header>
      <div className="prose prose-invert max-w-none text-terminal-gray leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {post.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
