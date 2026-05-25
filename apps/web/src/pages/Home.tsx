import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Typewriter from '../components/Typewriter';
import { apiGet } from '../lib/api';
import { SERIES } from '../lib/series';
import type { PostListPage, PostSummary } from '../lib/types';

const ASCII = String.raw`
 _
| |_ ___ _ __   __ _  __ _  ___  _   ___      ____ _
| __/ _ \ '_ \ / _\` |/ _\` |/ _ \| | | \ \ /\ / / _\` |
| ||  __/ | | | (_| | (_| | (_) | |_| |\ V  V / (_| |
 \__\___|_| |_|\__, |\__, |\___/ \__,_| \_/\_/ \__,_|
               |___/ |___/
`;

const LINES = [
  "echo 'welcome to tenggouwa.lab'",
  'whoami # 一个写前端、写后端、写脚本、写诗的人',
  'cat ./now.txt # 在折腾 monorepo + 极客小站',
  "ls ~/projects/ # 'web' 'admin' 'server' ...",
];

export default function Home() {
  const [latest, setLatest] = useState<PostSummary[] | null>(null);

  useEffect(() => {
    apiGet<PostListPage>('/api/public/posts?limit=3&offset=0')
      .then((p) => setLatest(p.items))
      .catch(() => setLatest([]));
  }, []);

  return (
    <div className="space-y-10">
      <pre className="text-terminal-green text-[10px] md:text-xs leading-tight shadow-glow overflow-x-auto">
        {ASCII}
      </pre>

      <div className="border border-terminal-line/70 bg-terminal-panel/50 rounded-lg p-5 md:p-6">
        <div className="flex items-center gap-2 text-xs text-terminal-gray mb-3">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="ml-2">tenggouwa@laptop ~ — zsh</span>
        </div>
        <Typewriter lines={LINES} />
      </div>

      {/* 最新文章 */}
      {latest && latest.length > 0 && (
        <section className="space-y-3 font-mono">
          <h2 className="text-terminal-green text-lg flex items-baseline gap-2">
            <span className="text-terminal-pink">$</span>
            <span>tail -3 posts/*.md</span>
          </h2>
          <ul className="space-y-2">
            {latest.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/posts/${p.slug}`}
                  className="group block px-3 py-2.5 rounded
                             border border-terminal-line/40
                             hover:border-terminal-green/50 hover:bg-terminal-green/5
                             transition-all"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-terminal-gray group-hover:text-terminal-green transition-colors truncate">
                      {p.title}
                    </h3>
                    <span className="text-[10px] text-terminal-gray/50 shrink-0 tabular-nums">
                      {p.published_at.slice(0, 10)}
                    </span>
                  </div>
                  {p.summary && (
                    <p className="text-xs text-terminal-gray/65 mt-1 line-clamp-1">{p.summary}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to="/posts"
            className="inline-block text-xs text-terminal-cyan hover:text-terminal-green transition-colors"
          >
            <span className="text-terminal-pink">~$</span> ls posts/ →
          </Link>
        </section>
      )}

      {/* 系列入口 */}
      {SERIES.length > 0 && (
        <section className="space-y-3 font-mono">
          <h2 className="text-terminal-green text-lg flex items-baseline gap-2">
            <span className="text-terminal-pink">$</span>
            <span>ls series/</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SERIES.map((s) => (
              <Link
                key={s.tag}
                to={`/series/${s.tag}`}
                className="group block p-4 rounded border border-terminal-line/40
                           hover:border-terminal-green/50 hover:bg-terminal-green/5
                           transition-all"
              >
                <div className="flex items-baseline gap-2 mb-1.5 text-xs">
                  <span className="text-terminal-pink shrink-0">~$</span>
                  <span className="text-terminal-cyan">{s.command_hint ?? `cat ${s.tag}/README`}</span>
                </div>
                <div className="text-terminal-gray group-hover:text-terminal-green transition-colors font-semibold">
                  {s.title} →
                </div>
                <p className="text-xs text-terminal-gray/65 mt-1.5 line-clamp-3 leading-relaxed">
                  {s.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 三大区块：保留 */}
      <section className="grid md:grid-cols-3 gap-4">
        <Card
          to="/posts"
          title="posts/"
          desc="技术 / 思考 / 折腾笔记"
          accent="text-terminal-green"
        />
        <Card
          to="/inspirations"
          title="inspirations/"
          desc="随手记的小灵感 & 闪念"
          accent="text-terminal-cyan"
        />
        <Card
          to="/lab"
          title="lab/"
          desc="前端实验室：shader / 粒子 / 玩具"
          accent="text-terminal-pink"
        />
      </section>

      {/* 入口很隐蔽：只有需要进 console 的人会留意，对一般访客只是一段闪光的命令 */}
      <Link
        to="/console"
        className="block text-xs font-mono text-terminal-gray/60 hover:text-terminal-green transition-colors select-none"
      >
        <span className="text-terminal-pink">$</span>{' '}
        ssh me@<span className="text-terminal-yellow">mac</span>{' '}
        <span className="text-terminal-gray/40"># open console →</span>
      </Link>
    </div>
  );
}

interface CardProps {
  to: string;
  title: string;
  desc: string;
  accent: string;
}

function Card({ to, title, desc, accent }: CardProps) {
  return (
    <Link
      to={to}
      className="block border border-terminal-line/70 bg-terminal-panel/40 hover:bg-terminal-panel hover:border-terminal-green/60 transition-colors rounded-lg p-5"
    >
      <div className={`text-lg font-semibold ${accent}`}>{title}</div>
      <div className="text-sm text-terminal-gray mt-2">{desc}</div>
      <div className="mt-4 text-xs text-terminal-gray/70">cd → enter</div>
    </Link>
  );
}
