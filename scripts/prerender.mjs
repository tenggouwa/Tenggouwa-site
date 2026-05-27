#!/usr/bin/env node
// SSG 预渲染：从 /api/public/posts 拉已发布文章，生成搜索引擎友好的静态 HTML，
// 同时生成 sitemap.xml / robots.txt / feed.xml / 标签聚合页。
//
// 用法:
//   node scripts/prerender.mjs --dist=<dir> --base=<base> --origin=<origin> \
//     [--api=https://api.tenggouwa.com] [--noindex]
//   未传 --api 时回落到环境变量 VITE_API_BASE。
//
// 设计：
// - 数据源单一化：DB → /api/public/posts 是唯一真相。content/posts/*.md
//   只是 publish-series.py 的输入，已经不再被这里直接消费——避免列表跟
//   SPA 看到的不一致。
// - 不依赖 React 运行时，纯静态 HTML（搜索引擎首屏即拿到正文）
// - CSS 复用 vite build 出来的 main bundle，视觉跟 SPA 一致
// - canonical / sitemap 始终指向 --origin（即正版根域名 tenggouwa.com）
// - --noindex：给 GitHub Pages 子路径产物加 robots noindex，避免双收录
//   稀释主域名权重

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    }
    return [a, true];
  }),
);

const DIST = path.resolve(ROOT, args.dist ?? 'pages-dist');
const BASE = normalizeBase(args.base ?? '/');
const ORIGIN = (args.origin ?? 'https://tenggouwa.com').replace(/\/$/, '');
const NOINDEX = Boolean(args.noindex);
const API_BASE = (args.api ?? process.env.VITE_API_BASE ?? '').replace(/\/$/, '');

const SITE_TITLE = 'tenggouwa · 极客小站';
const SITE_DESC = '腾构娃的极客小站：AI / 系统 / 工具的笔记、灵感与实验。';
const AUTHOR = 'tenggouwa';
const PUBLISHER_URL = ORIGIN;

function normalizeBase(b) {
  let s = b;
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s = s + '/';
  return s.replace(/\/+/g, '/');
}

const pageUrl = (p) => (BASE + p.replace(/^\//, '')).replace(/\/+/g, '/');
const canonical = (p) => ORIGIN + ('/' + p.replace(/^\//, '')).replace(/\/+/g, '/');

// 把多行 summary 压成单行，给 llms.txt / JSON-LD 等纯文本场景用
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// 文章所属系列：tag 里形如 `ai-series` / `linux-series` 的那个
const SERIES_NAMES = { ai: 'AI', linux: 'Linux' };
const seriesTagOf = (post) => post.tags.find((t) => t.endsWith('-series')) || null;
function seriesLabel(tag) {
  const base = tag.replace(/-series$/, '');
  const name = SERIES_NAMES[base] ?? base.charAt(0).toUpperCase() + base.slice(1);
  return `${name} 系列`;
}

// ---------- frontmatter ----------
function parseFM(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing frontmatter');
  const meta = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      meta[k] = v.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: m[2].replace(/^\n+/, '') };
}

// ---------- markdown ----------
marked.setOptions({ gfm: true, breaks: false });
// 服务端把 $...$ / $$...$$ 渲染成 KaTeX HTML，跟 SPA 的 remark-math/rehype-katex 对齐，
// 首屏即拿到公式（消除 hydrate 前的 raw LaTeX 跳变 + SEO 拿到正常公式）。
marked.use(markedKatex({ throwOnError: false }));
const renderMd = (md) => marked.parse(md);

// ---------- 收集文章（从 API 拉，DB 是唯一真相） ----------
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  const env = await res.json();
  if (env && typeof env === 'object' && 'code' in env && env.code !== 0) {
    throw new Error(`${url} → api code=${env.code} message=${env.message}`);
  }
  return env.data ?? env;
}

async function collectPosts() {
  if (!API_BASE) {
    throw new Error('API_BASE 未配置：传 --api=https://api.tenggouwa.com 或设 VITE_API_BASE');
  }
  // 列表：一次拉 100 篇足够，单博客规模够用很多年
  const page = await fetchJson(`${API_BASE}/api/public/posts?limit=100&offset=0`);
  const items = Array.isArray(page?.items) ? page.items : [];
  console.log(`==> listing api returned ${items.length}/${page?.total ?? '?'} posts`);

  const posts = [];
  for (const it of items) {
    try {
      const d = await fetchJson(`${API_BASE}/api/public/posts/${encodeURIComponent(it.slug)}`);
      posts.push({
        slug: d.slug,
        title: d.title ?? d.slug,
        summary: d.summary ?? '',
        tags: Array.isArray(d.tags) ? d.tags : [],
        publishedAt: d.published_at ?? '',
        body: d.content ?? '',
      });
    } catch (e) {
      console.warn(`skip ${it.slug}: ${e.message}`);
    }
  }
  // API 已经按 published_at desc 返回，这里再保证一次
  posts.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  return posts;
}

// ---------- 复用 vite 构建产物的 CSS / 字体 ----------
function findHeadAssets() {
  const idxPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(idxPath)) {
    throw new Error(`expected vite build output at ${idxPath}`);
  }
  const html = fs.readFileSync(idxPath, 'utf-8');
  // 抓 <link rel="stylesheet" href="...">（vite 注入的 main CSS）
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)].map(
    (m) => m[0],
  );
  // 抓 modulepreload，可有可无；保留增量性能
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+>/g)].map((m) => m[0]);
  return [...links, ...preloads].join('\n');
}

// vite 构建产物里的入口 module 脚本（带 hash）。注入到预渲染页后，SPA 会在
// 客户端用 createRoot 接管 #root：静态 HTML 只负责首屏 + SEO，挂载后由 React
// 重新向 /api/public/posts 拉最新数据，所以新文章不必重新预渲染部署。
function findEntryScript() {
  const idxPath = path.join(DIST, 'index.html');
  const html = fs.readFileSync(idxPath, 'utf-8');
  const m = html.match(/<script[^>]+type="module"[^>]+src="[^"]+"[^>]*>\s*<\/script>/);
  if (!m) {
    throw new Error(`entry module script not found in ${idxPath}`);
  }
  return m[0];
}

// ---------- HTML 模板 ----------
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAV_ITEMS = [
  { to: '/', label: '~', match: (cp) => cp === '/' },
  { to: '/posts/', label: 'posts', match: (cp) => cp.startsWith('/posts') || cp.startsWith('/tags') },
  { to: '/inspirations', label: 'inspirations', match: (cp) => cp.startsWith('/inspirations') },
  { to: '/lab', label: 'lab', match: (cp) => cp.startsWith('/lab') },
  { to: '/about', label: 'about', match: (cp) => cp.startsWith('/about') },
];

function navHtml(currentPath) {
  return NAV_ITEMS.map((it) => {
    const isActive = it.match(currentPath);
    const color = isActive ? 'text-terminal-green' : 'text-terminal-gray';
    return `<a href="${pageUrl(it.to)}" class="transition-colors hover:text-terminal-green ${color}">${it.label}</a>`;
  }).join('\n          ');
}

function shell({ title, description, currentPath, ogImage, jsonLd, bodyHtml, extraHead = '' }) {
  const head = findHeadAssets();
  const fullTitle = title === SITE_TITLE ? title : `${title} · tenggouwa`;
  const canonicalUrl = canonical(currentPath);
  const robots = NOINDEX ? '<meta name="robots" content="noindex,nofollow" />' : '<meta name="robots" content="index,follow,max-image-preview:large" />';
  const og = ogImage ? canonical(ogImage) : canonical('/og-default.png');
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '';
  const firstLd = Array.isArray(jsonLd) ? jsonLd[0] : jsonLd;
  const ogType = firstLd?.['@type'] === 'BlogPosting' ? 'article' : 'website';
  return `<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>${escapeHtml(fullTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonicalUrl}" />
    ${robots}
    <meta name="author" content="${AUTHOR}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="${SITE_TITLE}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${og}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${og}" />
    <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} RSS" href="${pageUrl('/feed.xml')}" />
    ${NOINDEX ? '' : `<link rel="alternate" type="text/plain" title="llms.txt" href="${pageUrl('/llms.txt')}" />`}
    <link rel="icon" type="image/svg+xml" href="${pageUrl('/favicon.svg')}" />
    ${bodyHtml && bodyHtml.includes('class="katex"') ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous" />' : ''}
    ${head}
    ${extraHead}
    ${ld}
  </head>
  <body class="bg-terminal-bg text-terminal-gray font-mono">
    <div id="root">
    <div class="min-h-screen flex flex-col">
      <header class="border-b border-terminal-line/60 backdrop-blur sticky top-0 z-50 bg-terminal-bg/70">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-2 sm:py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
          <a href="${pageUrl('/')}" class="text-terminal-green font-bold tracking-wide whitespace-nowrap">
            <span class="text-terminal-pink">~$</span> tenggouwa
          </a>
          <nav class="flex gap-3 sm:gap-5 text-sm flex-wrap">
          ${navHtml(currentPath)}
          </nav>
        </div>
      </header>
      <main class="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        ${bodyHtml}
      </main>
      <footer class="border-t border-terminal-line/60 text-xs text-terminal-gray/70">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:justify-between gap-1">
          <span>© ${new Date().getFullYear()} ${AUTHOR} · made with caffeine ☕</span>
          <div class="flex items-center gap-3">
            <a href="${pageUrl('/feed.xml')}" class="text-terminal-gray/50 hover:text-terminal-green transition-colors">RSS</a>
            <span class="text-terminal-cyan">[ uptime: ∞ ]</span>
          </div>
        </div>
      </footer>
    </div>
    </div>
    ${findEntryScript()}
  </body>
</html>
`;
}

// ---------- 各页面 body ----------
function postListBody(posts, { tag } = {}) {
  const list = tag ? posts.filter((p) => p.tags.includes(tag)) : posts;
  const heading = tag
    ? `<span class="text-terminal-pink">$ </span>grep -l <span class="text-terminal-yellow">${escapeHtml(tag)}</span> posts/*.md`
    : `<span class="text-terminal-pink">$ </span>cat posts/*.md`;
  const items = list
    .map((p) => {
      const tags = p.tags
        .map(
          (t) =>
            `<a href="${pageUrl(`/tags/${encodeURIComponent(t)}/`)}" class="text-xs px-2 py-0.5 rounded border border-terminal-line/80 text-terminal-green hover:bg-terminal-green/10 transition-colors">${escapeHtml(t)}</a>`,
        )
        .join('\n            ');
      const date = (p.publishedAt || '').slice(0, 10);
      return `<li class="py-5 border-b border-terminal-line/60">
        <a href="${pageUrl(`/posts/${p.slug}/`)}" class="group block">
          <div class="flex items-baseline justify-between gap-4">
            <h2 class="text-lg text-terminal-gray group-hover:text-terminal-green transition-colors">${escapeHtml(p.title)}</h2>
            <span class="text-xs text-terminal-gray/70 shrink-0">${escapeHtml(date)}</span>
          </div>
          <p class="text-sm text-terminal-gray/80 mt-2">${escapeHtml(p.summary)}</p>
          <div class="mt-2 flex gap-2 flex-wrap">
            ${tags}
          </div>
        </a>
      </li>`;
    })
    .join('\n');
  return `
    <div class="space-y-6">
      <h1 class="text-terminal-green text-2xl">${heading}</h1>
      <ul class="divide-y divide-terminal-line/60">
${items || '<li class="py-5 text-terminal-gray/60">空空如也。</li>'}
      </ul>
    </div>
  `;
}

function postDetailBody(post, { prev, next }) {
  const date = (post.publishedAt || '').slice(0, 10);
  const tagBadges = post.tags
    .map(
      (t) =>
        `<a href="${pageUrl(`/tags/${encodeURIComponent(t)}/`)}" class="text-xs px-2 py-0.5 rounded border border-terminal-line/80 text-terminal-green hover:bg-terminal-green/10 transition-colors">${escapeHtml(t)}</a>`,
    )
    .join('\n          ');
  const html = renderMd(post.body);
  const nav = (prev || next)
    ? `<nav class="mt-12 pt-6 border-t border-terminal-line/60 flex justify-between gap-4 text-sm">
        ${prev ? `<a href="${pageUrl(`/posts/${prev.slug}/`)}" class="text-terminal-cyan hover:underline">← ${escapeHtml(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a href="${pageUrl(`/posts/${next.slug}/`)}" class="text-terminal-cyan hover:underline text-right">${escapeHtml(next.title)} →</a>` : '<span></span>'}
      </nav>`
    : '';
  return `
    <article class="space-y-6">
      <a href="${pageUrl('/posts/')}" class="text-xs text-terminal-cyan hover:underline">← cd ../posts</a>
      <header class="space-y-2 border-b border-terminal-line/60 pb-4">
        <h1 class="text-2xl text-terminal-green">${escapeHtml(post.title)}</h1>
        <div class="text-xs text-terminal-gray/80">${escapeHtml(date)}</div>
        <div class="flex gap-2 flex-wrap">
          ${tagBadges}
        </div>
      </header>
      <div class="prose prose-invert max-w-none">
${html}
      </div>
      ${nav}
    </article>
  `;
}

// ---------- JSON-LD ----------
function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_TITLE,
    url: ORIGIN + '/',
    description: SITE_DESC,
    inLanguage: 'zh-CN',
    publisher: { '@type': 'Person', name: AUTHOR, url: PUBLISHER_URL },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${ORIGIN}/posts/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

// CJK 没有空格，按「中文字符数 + 拉丁词数」粗算字数，给 AI 引擎一个体量信号
function wordCount(md = '') {
  const cjk = (md.match(/[一-鿿]/g) || []).length;
  const latin = (md.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

function blogPostingLd(post) {
  const series = seriesTagOf(post);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    inLanguage: 'zh-CN',
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: { '@type': 'Person', name: AUTHOR, url: PUBLISHER_URL },
    publisher: { '@type': 'Person', name: AUTHOR, url: PUBLISHER_URL },
    isPartOf: { '@type': 'WebSite', name: SITE_TITLE, url: ORIGIN + '/' },
    mainEntityOfPage: canonical(`/posts/${post.slug}/`),
    url: canonical(`/posts/${post.slug}/`),
    keywords: post.tags.join(', '),
    articleSection: series ? seriesLabel(series) : post.tags[0],
    wordCount: wordCount(post.body),
    isAccessibleForFree: true,
    image: canonical(`/og/${post.slug}.png`),
  };
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: canonical(it.path),
    })),
  };
}

// ---------- 写文件 ----------
function writeFile(rel, content) {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`  ✓ ${rel}`);
}

// ---------- sitemap / robots / feed ----------
function buildSitemap(posts, tags) {
  const urls = [
    { loc: canonical('/'), changefreq: 'weekly', priority: '1.0' },
    { loc: canonical('/posts/'), changefreq: 'weekly', priority: '0.9' },
    { loc: canonical('/about'), changefreq: 'monthly', priority: '0.6' },
    ...posts.map((p) => ({
      loc: canonical(`/posts/${p.slug}/`),
      lastmod: (p.publishedAt || '').slice(0, 10) || undefined,
      changefreq: 'monthly',
      priority: '0.8',
    })),
    ...tags.map((t) => ({
      loc: canonical(`/tags/${encodeURIComponent(t)}/`),
      changefreq: 'weekly',
      priority: '0.5',
    })),
  ];
  const items = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

// 已知的生成式 AI / LLM 爬虫。`User-agent: *  Allow: /` 已涵盖它们，这里再
// 显式列一遍是为了表态「欢迎抓取并引用」（GEO）——尤其 Google-Extended /
// Applebot-Extended 默认放行但靠显式声明确认 opt-in。
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'Meta-ExternalAgent',
];

function buildRobots() {
  if (NOINDEX) {
    return `User-agent: *\nDisallow: /\n`;
  }
  // 多个连续 User-agent 行共享其后的一组规则
  const aiBlock = AI_CRAWLERS.map((b) => `User-agent: ${b}`).join('\n') + '\nAllow: /\n';
  return (
    `# 欢迎搜索引擎与生成式 AI 引擎抓取并引用本站内容（GEO）。\n` +
    `# LLM 友好索引见 ${ORIGIN}/llms.txt ，全文合集见 ${ORIGIN}/llms-full.txt 。\n` +
    `User-agent: *\nAllow: /\n\n` +
    `${aiBlock}\n` +
    `Sitemap: ${ORIGIN}/sitemap.xml\n`
  );
}

function buildRss(posts) {
  const items = posts
    .slice(0, 30)
    .map((p) => {
      const pubDate = p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString();
      const link = canonical(`/posts/${p.slug}/`);
      const categories = p.tags.map((t) => `<category>${escapeHtml(t)}</category>`).join('');
      return `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${p.summary}]]></description>
      ${categories}
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(SITE_TITLE)}</title>
    <link>${ORIGIN}/</link>
    <description>${escapeHtml(SITE_DESC)}</description>
    <language>zh-CN</language>
    <atom:link href="${canonical('/feed.xml')}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

// ---------- GEO：LLM 友好产物 ----------
// 单篇文章的纯 markdown（标题 + 元信息 + 正文源）。给 /posts/<slug>.md，也是
// llms-full.txt 的拼装单元；LLM 抓这个比解析 HTML 干净得多。
function postMarkdown(post) {
  const date = (post.publishedAt || '').slice(0, 10);
  const meta = [`- URL: ${canonical(`/posts/${post.slug}/`)}`];
  if (date) meta.push(`- 发布: ${date}`);
  if (post.tags.length) meta.push(`- 标签: ${post.tags.join(', ')}`);
  const header = [
    `# ${oneLine(post.title)}`,
    '',
    ...(post.summary ? [`> ${oneLine(post.summary)}`, ''] : []),
    ...meta,
  ].join('\n');
  return `${header}\n\n${post.body.trim()}\n`;
}

// llms.txt（llmstxt.org 约定）：给 LLM 的站点导航——H1 + 简介 + 按系列分组的链接清单
function buildLlmsTxt(posts) {
  const groups = new Map();
  const standalone = [];
  for (const p of posts) {
    const s = seriesTagOf(p);
    if (s) {
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(p);
    } else {
      standalone.push(p);
    }
  }
  const link = (p) => `- [${oneLine(p.title)}](${canonical(`/posts/${p.slug}/`)}): ${oneLine(p.summary)}`;
  const out = [
    `# ${SITE_TITLE}`,
    '',
    `> ${SITE_DESC}`,
    '',
    '本站文章以中文写作，覆盖 AI 大模型原理、Linux / 系统底层、前端与工具实验。' +
      '每篇的 markdown 源在 `/posts/<slug>.md`，全部正文合集见 `/llms-full.txt`。',
    '',
  ];
  for (const s of [...groups.keys()].sort()) {
    // 系列内按发布时间正序，符合阅读 / 学习顺序
    const items = groups.get(s).slice().sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || ''));
    out.push(`## ${seriesLabel(s)}`, '', ...items.map(link), '');
  }
  if (standalone.length) {
    out.push('## 其它文章', '', ...standalone.map(link), '');
  }
  out.push(
    '## Optional',
    '',
    `- [全文合集](${canonical('/llms-full.txt')}): 所有文章正文合并的 markdown，可一次性喂给模型`,
    `- [RSS](${canonical('/feed.xml')}): 更新订阅源`,
    `- [关于](${canonical('/about')}): 关于作者与本站`,
    '',
  );
  return out.join('\n');
}

// llms-full.txt：全站正文合集，按发布时间倒序拼接
function buildLlmsFull(posts) {
  const head = [
    `# ${SITE_TITLE} — 全文合集`,
    '',
    `> ${SITE_DESC}`,
    '',
    `本文件包含本站全部 ${posts.length} 篇文章的正文（markdown 源），按发布时间倒序，` +
      `生成于 ${new Date().toISOString().slice(0, 10)}。`,
    '',
  ].join('\n');
  return `${head}\n${posts.map(postMarkdown).join('\n---\n\n')}`;
}

// ---------- main ----------
async function main() {
  if (!fs.existsSync(DIST)) {
    throw new Error(`dist not found: ${DIST}`);
  }
  console.log(`==> prerender into ${DIST} (base=${BASE}, origin=${ORIGIN}, api=${API_BASE}, noindex=${NOINDEX})`);
  const posts = await collectPosts();
  console.log(`==> ${posts.length} posts`);

  const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();

  // 详情页
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    // posts 是按时间倒序的；prev 表示更早一篇，next 表示更新一篇
    const next = posts[i - 1];
    const prev = posts[i + 1];
    const path0 = `/posts/${post.slug}/`;
    const html = shell({
      title: post.title,
      description: post.summary || post.title,
      currentPath: path0,
      ogImage: `/og/${post.slug}.png`,
      // 给 LLM / 工具一个干净的 markdown 源入口（仅公网正版产物生成 .md）
      extraHead: NOINDEX
        ? ''
        : `<link rel="alternate" type="text/markdown" title="${escapeHtml(post.title)} (markdown)" href="${pageUrl(`/posts/${post.slug}.md`)}" />`,
      jsonLd: [
        blogPostingLd(post),
        breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Posts', path: '/posts/' },
          { name: post.title, path: path0 },
        ]),
      ],
      bodyHtml: postDetailBody(post, { prev, next }),
    });
    writeFile(`posts/${post.slug}/index.html`, html);
    if (!NOINDEX) {
      writeFile(`posts/${post.slug}.md`, postMarkdown(post));
    }
  }

  // 列表页
  writeFile(
    'posts/index.html',
    shell({
      title: 'Posts · tenggouwa',
      description: '所有文章列表。AI 系列、系统笔记、工具实验。',
      currentPath: '/posts/',
      jsonLd: [
        websiteLd(),
        breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Posts', path: '/posts/' },
        ]),
      ],
      bodyHtml: postListBody(posts),
    }),
  );

  // 标签聚合
  for (const tag of allTags) {
    writeFile(
      `tags/${tag}/index.html`,
      shell({
        title: `#${tag} · tenggouwa`,
        description: `标签 ${tag} 下的所有文章。`,
        currentPath: `/tags/${tag}/`,
        jsonLd: breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Posts', path: '/posts/' },
          { name: `#${tag}`, path: `/tags/${tag}/` },
        ]),
        bodyHtml: postListBody(posts, { tag }),
      }),
    );
  }

  // about 页（如有 content/about.md 走它，否则给个空壳）
  const aboutMd = path.join(ROOT, 'content/about.md');
  if (fs.existsSync(aboutMd)) {
    const { meta, body } = parseFM(fs.readFileSync(aboutMd, 'utf-8'));
    writeFile(
      'about/index.html',
      shell({
        title: meta.title ?? 'About',
        description: meta.summary ?? '关于腾构娃。',
        currentPath: '/about',
        jsonLd: websiteLd(),
        bodyHtml: `<article class="prose prose-invert max-w-none">${renderMd(body)}</article>`,
      }),
    );
  }

  // sitemap / robots / feed
  writeFile('sitemap.xml', buildSitemap(posts, allTags));
  writeFile('robots.txt', buildRobots());
  writeFile('feed.xml', buildRss(posts));

  // GEO：LLM 友好产物（仅公网正版产物，避免 AI 收录 github.io 子路径副本）
  if (!NOINDEX) {
    writeFile('llms.txt', buildLlmsTxt(posts));
    writeFile('llms-full.txt', buildLlmsFull(posts));
  }

  // IndexNow key 文件：搜索引擎抓 https://<host>/<KEY>.txt 验证所有权
  // 仅在非 noindex 产物（即真正面向公网的版本）写
  const indexNowKey = process.env.INDEXNOW_KEY;
  if (indexNowKey && !NOINDEX) {
    const safe = indexNowKey.replace(/[^a-zA-Z0-9]/g, '');
    if (safe.length >= 8) {
      writeFile(`${safe}.txt`, safe);
    }
  }

  console.log('==> done');
}

main().catch((e) => {
  console.error('prerender failed:', e);
  process.exit(1);
});
