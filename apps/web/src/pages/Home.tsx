import { Link } from 'react-router-dom';
import Typewriter from '../components/Typewriter';

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
  return (
    <div className="space-y-10">
      <pre className="text-terminal-green text-[10px] md:text-xs leading-tight shadow-glow overflow-x-auto">
        {ASCII}
      </pre>

      <div className="border border-terminal-line/70 bg-terminal-panel/50 rounded-lg p-5 md:p-6">
        <div className="flex items-center gap-2 text-xs text-terminal-gray mb-3">
          <span className="w-3 h-3 rounded-full bg-red-400/70" />
          <span className="w-3 h-3 rounded-full bg-yellow-400/70" />
          <span className="w-3 h-3 rounded-full bg-green-400/70" />
          <span className="ml-2">tenggouwa@laptop ~ — zsh</span>
        </div>
        <Typewriter lines={LINES} />
      </div>

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
