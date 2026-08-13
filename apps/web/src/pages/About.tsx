import { CONTACT_EMAIL, GITHUB_URL, RSS_URL } from '../lib/projects';
import { trackEvent } from '../lib/track';

export default function About() {
  return (
    <div className="space-y-6 text-terminal-gray leading-relaxed">
      <h1 className="text-terminal-yellow text-2xl">
        <span className="text-terminal-pink">$ </span>whoami
      </h1>
      <pre className="text-sm border border-terminal-line/60 bg-terminal-panel/40 rounded-lg p-5 whitespace-pre-wrap">
{`name      : tenggouwa
roles     : engineer / tinkerer / 写诗的人
languages : python · typescript · go · 中文
stack     : react · fastapi · postgres · k8s · llm
hobbies   : 折腾 · 烹饪 · 摄影 · 读书 · 写小灵感
contact   : tenggouwa@gmail.com`}
      </pre>
      <p className="text-sm">
        这个站点是一个 monorepo：前端挂在 GitHub Pages / Cloudflare Pages，后端 FastAPI 部署在自己的服务器上。
      </p>
      <div className="rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-5">
        <div className="mb-3 text-xs text-terminal-gray/55">
          <span className="text-terminal-pink">~$</span> ls ~/contact
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
          <a
            className="text-terminal-green hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-yellow"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent('github_open', 'web', 'about')}
          >
            github →
          </a>
          <a
            className="text-terminal-cyan hover:text-terminal-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-yellow"
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('来自 tenggouwa.com 的交流')}`}
            onClick={() => trackEvent('email_open', 'web', 'about')}
          >
            {CONTACT_EMAIL} →
          </a>
          <a
            className="text-terminal-yellow hover:text-terminal-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-yellow"
            href={RSS_URL}
            onClick={() => trackEvent('rss_open', 'web', 'about')}
          >
            RSS →
          </a>
        </div>
      </div>
    </div>
  );
}
