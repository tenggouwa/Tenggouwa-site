import { Link } from 'react-router-dom';
import { PROJECTS, type Project } from '../lib/projects';
import { trackEvent } from '../lib/track';

const ACCENT: Record<Project['accent'], { text: string; border: string }> = {
  green: { text: 'text-terminal-green', border: 'hover:border-terminal-green/60' },
  cyan: { text: 'text-terminal-cyan', border: 'hover:border-terminal-cyan/60' },
  pink: { text: 'text-terminal-pink', border: 'hover:border-terminal-pink/60' },
  yellow: { text: 'text-terminal-yellow', border: 'hover:border-terminal-yellow/60' },
};

export default function Projects() {
  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b border-terminal-line/60 pb-6">
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>ls ~/projects
        </h1>
        <p className="max-w-3xl text-sm leading-7 text-terminal-gray/80">
          不是技术名词清单。这里记录已经在运行、可体验或可审阅的项目：它们解决的问题、做出的取舍与可验证的结果。
        </p>
      </header>

      <section className="grid gap-4">
        {PROJECTS.map((project) => (
          <ProjectCard key={project.slug} project={project} />
        ))}
      </section>

      <section className="rounded-lg border border-terminal-line/70 bg-terminal-panel/35 p-5 sm:p-6">
        <div className="mb-2 text-xs text-terminal-gray/55">
          <span className="text-terminal-pink">~$</span> printf 'work together?\\n'
        </div>
        <p className="text-sm leading-7 text-terminal-gray/80">
          想交流一个项目、技术设计或工具思路？可以从 About 页取得联系；仓库、RSS 与公开 Agent 也都在那里。
        </p>
        <Link
          to="/about"
          onClick={() => trackEvent('contact_cta_click', 'web', '/projects')}
          className="mt-4 inline-flex min-h-11 items-center rounded border border-terminal-green/50 px-3 text-xs text-terminal-green transition-colors hover:bg-terminal-green/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-yellow"
        >
          cd ../about →
        </Link>
      </section>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const accent = ACCENT[project.accent];
  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-terminal-gray/55">
            <span className="text-terminal-pink">~$</span> {project.command}
          </div>
          <h2 className={`mt-2 text-xl font-semibold ${accent.text}`}>{project.title}</h2>
        </div>
        <span className="rounded border border-terminal-line/70 px-2 py-1 text-[10px] text-terminal-gray/65">
          {project.kind === 'internal' ? 'live demo' : 'repository'}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-terminal-gray">{project.summary}</p>
      <dl className="mt-5 grid gap-3 text-xs leading-5 sm:grid-cols-3">
        <div>
          <dt className="text-terminal-pink">problem</dt>
          <dd className="mt-1 text-terminal-gray/70">{project.problem}</dd>
        </div>
        <div>
          <dt className="text-terminal-cyan">approach</dt>
          <dd className="mt-1 text-terminal-gray/70">{project.approach}</dd>
        </div>
        <div>
          <dt className="text-terminal-green">result</dt>
          <dd className="mt-1 text-terminal-gray/70">{project.result}</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {project.stack.map((item) => (
          <span key={item} className="rounded border border-terminal-line/60 px-2 py-0.5 text-[10px] text-terminal-gray/65">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-5 text-xs text-terminal-gray/60 group-hover:text-terminal-green transition-colors">
        {project.kind === 'internal' ? `./${project.slug} →` : 'git remote -v →'}
      </div>
    </>
  );
  const className = `group block rounded-lg border border-terminal-line/70 bg-terminal-panel/40 p-5 sm:p-6 transition-colors ${accent.border} hover:bg-terminal-panel/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-yellow`;

  if (project.kind === 'external') {
    return (
      <a
        href={project.href}
        target="_blank"
        rel="noreferrer"
        onClick={() => trackEvent('project_open', 'web', project.slug)}
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <Link to={project.href} onClick={() => trackEvent('project_open', 'web', project.slug)} className={className}>
      {content}
    </Link>
  );
}
