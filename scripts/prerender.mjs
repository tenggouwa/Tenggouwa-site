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
const SITE_DESC = 'tenggouwa的极客小站：AI / 系统 / 工具的笔记、灵感与实验。';
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

// 并发限制：N 篇文章并发 fetch /posts/<slug> 详情；同时也避免 23+ 并发把后端
// 打瘫。8 在单 H100 / 4 核 VPS 上是个稳妥默认；fetch 全在同一 keep-alive 连接池里。
const FETCH_CONCURRENCY = 8;

async function fetchInPool(items, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function pull() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (e) {
        out[i] = { __error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, pull));
  return out;
}

async function collectPosts() {
  if (!API_BASE) {
    throw new Error('API_BASE 未配置：传 --api=https://api.tenggouwa.com 或设 VITE_API_BASE');
  }
  // 列表：一次拉 100 篇足够，单博客规模够用很多年
  const page = await fetchJson(`${API_BASE}/api/public/posts?limit=100&offset=0`);
  const items = Array.isArray(page?.items) ? page.items : [];
  console.log(`==> listing api returned ${items.length}/${page?.total ?? '?'} posts`);

  // 并发拉详情（顺序无关，最终用 published_at 排序）
  const t0 = performance.now();
  const results = await fetchInPool(items, (it) =>
    fetchJson(`${API_BASE}/api/public/posts/${encodeURIComponent(it.slug)}`),
  );
  const ms = (performance.now() - t0).toFixed(0);

  const posts = [];
  results.forEach((d, i) => {
    if (d && d.__error) {
      console.warn(`skip ${items[i].slug}: ${d.__error}`);
      return;
    }
    posts.push({
      slug: d.slug,
      title: d.title ?? d.slug,
      summary: d.summary ?? '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      publishedAt: d.published_at ?? '',
      updatedAt: d.updated_at ?? d.published_at ?? '',
      body: d.content ?? '',
    });
  });
  console.log(`==> fetched ${posts.length} bodies in ${ms}ms (concurrency=${FETCH_CONCURRENCY})`);

  // API 已经按 published_at desc 返回，这里再保证一次
  posts.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  return posts;
}

// 小灵感：短文本闪念，一次列表拉全（规模很小）。失败不影响正文构建（posts 才是命脉）。
async function collectInspirations() {
  if (!API_BASE) return [];
  try {
    const page = await fetchJson(`${API_BASE}/api/public/inspirations?limit=100&offset=0`);
    const items = Array.isArray(page?.items) ? page.items : [];
    return items.map((it) => ({
      content: it.content ?? '',
      mood: it.mood ?? '',
      createdAt: it.created_at ?? '',
    }));
  } catch (e) {
    console.warn(`skip inspirations: ${e instanceof Error ? e.message : e}`);
    return [];
  }
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
  { to: '/ask', label: 'ask', match: (cp) => cp.startsWith('/ask') },
  { to: '/about', label: 'about', match: (cp) => cp.startsWith('/about') },
  // casino 是独立 SPA（不同 basename），整页链接；与 Layout.tsx 的 nav 保持一致
  { to: '/casino/', label: 'casino', match: (cp) => cp.startsWith('/casino') },
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

// 系列页：把该系列文章按发布顺序（升序）排成一条「第 N 篇」的阅读线。
// 这条路由（/series/<tag>）被首页 / 列表 / 详情页三处内链指向，之前没预渲染，
// 爬虫点进去是空壳；这里出静态正文闭合缺口。
function seriesBody(seriesPosts, label) {
  const items = seriesPosts
    .map((p, i) => {
      const date = (p.publishedAt || '').slice(0, 10);
      return `<li class="py-4 border-b border-terminal-line/60">
        <a href="${pageUrl(`/posts/${p.slug}/`)}" class="group block">
          <div class="flex items-baseline justify-between gap-4">
            <h2 class="text-base text-terminal-gray group-hover:text-terminal-green transition-colors"><span class="text-terminal-cyan mr-2">${String(i + 1).padStart(2, '0')}.</span>${escapeHtml(p.title)}</h2>
            <span class="text-xs text-terminal-gray/70 shrink-0">${escapeHtml(date)}</span>
          </div>
          <p class="text-sm text-terminal-gray/80 mt-1">${escapeHtml(p.summary)}</p>
        </a>
      </li>`;
    })
    .join('\n');
  return `
    <div class="space-y-6">
      <h1 class="text-terminal-green text-2xl"><span class="text-terminal-pink">$ </span>cd series/<span class="text-terminal-yellow">${escapeHtml(label)}</span></h1>
      <p class="text-sm text-terminal-gray/70">按发布顺序阅读，共 ${seriesPosts.length} 篇。</p>
      <ul class="divide-y divide-terminal-line/60">
${items || '<li class="py-5 text-terminal-gray/60">空空如也。</li>'}
      </ul>
    </div>
  `;
}

function relatedHtml(related) {
  if (!related || !related.length) return '';
  const items = related
    .map(
      (p) => `<li>
          <a href="${pageUrl(`/posts/${p.slug}/`)}" class="group block p-2 rounded border border-terminal-line/40 hover:border-terminal-green/50 hover:bg-terminal-green/5 transition-all">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-terminal-gray group-hover:text-terminal-green transition-colors text-sm">${escapeHtml(p.title)}</span>
              <span class="text-[10px] text-terminal-gray/50 shrink-0">${escapeHtml((p.publishedAt || '').slice(0, 10))}</span>
            </div>
            ${p.summary ? `<p class="text-xs text-terminal-gray/70 mt-1">${escapeHtml(p.summary)}</p>` : ''}
          </a>
        </li>`,
    )
    .join('\n');
  return `<section class="mt-12 pt-6 border-t border-terminal-line/60">
        <h3 class="text-terminal-green text-sm mb-3"><span class="text-terminal-pink">$</span> ls related/</h3>
        <ul class="space-y-2">
${items}
        </ul>
      </section>`;
}

function postDetailBody(post, { prev, next, related }) {
  const date = (post.publishedAt || '').slice(0, 10);
  const tagBadges = post.tags
    .map(
      (t) =>
        `<a href="${pageUrl(`/tags/${encodeURIComponent(t)}/`)}" class="text-xs px-2 py-0.5 rounded border border-terminal-line/80 text-terminal-green hover:bg-terminal-green/10 transition-colors">${escapeHtml(t)}</a>`,
    )
    .join('\n          ');
  const html = renderMd(post.body);
  const seriesTag = seriesTagOf(post);
  const seriesLink = seriesTag
    ? `<a href="${pageUrl(`/series/${encodeURIComponent(seriesTag)}/`)}" class="text-xs text-terminal-cyan hover:underline">◈ ${escapeHtml(seriesLabel(seriesTag))}</a>`
    : '';
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
        <div class="flex items-center gap-3 text-xs text-terminal-gray/80">
          <span>${escapeHtml(date)}</span>
          ${seriesLink}
        </div>
        <div class="flex gap-2 flex-wrap">
          ${tagBadges}
        </div>
      </header>
      <div class="prose prose-invert max-w-none">
${html}
      </div>
      ${relatedHtml(related)}
      ${nav}
    </article>
  `;
}

// 按共享标签数给 post 找相关文章（近似后端 /related：标签重叠越多越相关），
// 排除自身与 prev/next，取前 3。给爬虫一张内链关系网。
function relatedPosts(post, all, exclude) {
  const skip = new Set([post.slug, ...exclude.filter(Boolean).map((p) => p.slug)]);
  return all
    .filter((p) => !skip.has(p.slug))
    .map((p) => ({ p, overlap: p.tags.filter((t) => post.tags.includes(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (b.p.publishedAt || '').localeCompare(a.p.publishedAt || ''))
    .slice(0, 3)
    .map((x) => x.p);
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

// 作者实体：给 AI 引擎一个可识别的 Person 节点（E-E-A-T / 作者权威性）。
// 复用在首页 / about / 文章的 author-publisher 上，统一实体标识。
function personLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: AUTHOR,
    url: PUBLISHER_URL,
    jobTitle: '软件工程师',
    knowsAbout: ['AI 大模型', 'Linux 系统', '前端工程', 'FastAPI', '工具开发'],
  };
}

// 文章 author / publisher 复用的精简 Person（不带 @context，供内嵌）
const authorRef = { '@type': 'Person', name: AUTHOR, url: PUBLISHER_URL };

// dateModified 不能早于 datePublished：AI 系列按未来 published_at 排期发布，而
// updated_at 是过去的行写入时间，直接用会得到「改早于发」的非法语义（schema 校验告警）。
// ISO 8601 字符串可直接字典序比较，取较晚的一个。
function laterDate(a, b) {
  const x = a || '';
  const y = b || '';
  return x > y ? x : y;
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
    dateModified: laterDate(post.updatedAt, post.publishedAt),
    author: authorRef,
    publisher: authorRef,
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

// 文章集合的有序清单：给 AI / 搜索引擎一个显式的「这页有哪些文章」结构信号。
// name 可选传（如系列名），默认全站文章列表。
function itemListLd(posts, { name } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name ? { name } : {}),
    numberOfItems: posts.length,
    itemListElement: posts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: canonical(`/posts/${p.slug}/`),
      name: p.title,
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

// ---------- /lab 静态页 ----------
// 与 apps/web/src/pages/Lab.tsx 的 TOYS 保持同步：新增玩具两边都要加，
// 否则该玩具的深链接会回退到 SPA（首次请求 404）。
const LAB_TOYS = [
  { slug: 'matrix', title: 'matrix-rain', desc: '经典数字雨。半角假名 + ASCII，自带 bloom。', accent: 'green', how: '每列字符按帧下落、尾部渐隐，落到底或随机时重置起点，叠加辉光模拟《黑客帝国》数字雨。' },
  { slug: 'flock', title: 'flock.boids', desc: 'Boids 鸟群算法。鼠标当吸引子，发光拖尾。', accent: 'cyan', how: 'Boids 三条局部规则——分离 / 对齐 / 聚合，每个个体只看邻居就涌现出整体鸟群行为。' },
  { slug: 'donut', title: 'donut.c', desc: '致敬 a1k0n。3D torus 投影到 ASCII 字符。', accent: 'cyan', how: '把环面参数方程逐点旋转投影到 2D 屏幕，按表面法向量与光源的点积挑选 ASCII 亮度字符。' },
  { slug: 'wave', title: 'wave.field', desc: '2D 波动方程 + 阻尼。点 / 拖产生字符涟漪。', accent: 'cyan', how: '把 2D 波动方程离散化，用邻格高度差分逐帧传播、再乘阻尼系数衰减，得到字符涟漪。' },
  { slug: 'rope', title: 'rope.verlet', desc: 'Verlet 物理绳。鼠标拖任意节点，gravity 可调。', accent: 'pink', how: 'Verlet 积分：用前后两帧位置隐式推出速度，再多次迭代距离约束维持节点间距，形成柔韧绳子。' },
  { slug: 'snake', title: 'snake.sh', desc: '终端栅格贪吃蛇。方向键 / hjkl 操作。', accent: 'pink', how: '栅格状态机：蛇身是一条队列，蛇头入队、蛇尾出队；吃到食物时不出队即实现增长。' },
  { slug: '2048', title: '2048.exe', desc: '经典数字消除。↑↓←→ 移动方块，merge same number。', accent: 'yellow', how: '每步把一行 / 列的非空格向一侧靠拢、相邻同值合并一次，再在随机空格生成 2 或 4。' },
  { slug: 'life', title: 'conway.life', desc: '生命游戏。点格子编辑，可播放 / 步进 / 随机化。', accent: 'yellow', how: 'Conway 规则：每格看 8 个邻居，活格 2~3 个邻居存活、死格恰 3 个邻居复活，其余死亡。' },
  { slug: 'mandelbrot', title: 'mandelbrot.ascii', desc: '逃逸时间分形，按字符密度渲染。点击放大、拖动平移、无限下钻。', accent: 'green', how: '对每个点迭代 z = z² + c，按其模长逃逸出阈值所需的步数映射字符密度，即逃逸时间算法。' },
  { slug: 'reaction', title: 'reaction.diffusion', desc: 'Gray-Scott 反应扩散。自组织出珊瑚 / 分裂 / 斑点，点击注入、切换预设。', accent: 'cyan', how: 'Gray-Scott 模型：两种化学物质各自扩散并按非线性速率反应，参数差异自组织出珊瑚 / 斑点等图案。' },
];

const LAB_ACCENT_TEXT = {
  green: 'text-terminal-green',
  cyan: 'text-terminal-cyan',
  pink: 'text-terminal-pink',
  yellow: 'text-terminal-yellow',
};

function labListBody() {
  const cards = LAB_TOYS.map(
    (t) => `<a href="${pageUrl(`/lab/${t.slug}`)}" class="group block border border-terminal-line/70 bg-terminal-panel/40 rounded-lg p-5 transition-colors hover:border-terminal-green/60">
        <div class="text-lg font-semibold ${LAB_ACCENT_TEXT[t.accent]} mb-2">${escapeHtml(t.title)}</div>
        <div class="text-sm text-terminal-gray">${escapeHtml(t.desc)}</div>
        <div class="mt-4 text-xs text-terminal-gray/70 group-hover:text-terminal-green transition-colors">./${escapeHtml(t.slug)} <span class="opacity-60">↵</span></div>
      </a>`,
  ).join('\n');
  return `
    <div class="space-y-8">
      <div class="space-y-2">
        <h1 class="text-terminal-pink text-2xl"><span class="text-terminal-pink">$ </span>ls ./lab</h1>
        <p class="text-sm text-terminal-gray">前端实验室。一些跑在浏览器里的小玩具，点进去看。</p>
      </div>
      <section class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
${cards}
      </section>
    </div>
  `;
}

// 玩具本体是 canvas 交互组件，无法预渲染；这里只出 LabFrame 外壳（面包屑 + 标题 +
// 描述 + 占位），让深链接 200 命中并带正确 meta，SPA 挂载后替换占位。
function labToyBody(toy) {
  return `
    <div class="space-y-5">
      <div class="text-xs text-terminal-gray flex items-center gap-2">
        <a href="${pageUrl('/lab')}" class="hover:text-terminal-green transition-colors">../lab</a>
        <span class="text-terminal-line">/</span>
        <span class="text-terminal-gray/80">${escapeHtml(toy.slug)}</span>
      </div>
      <h1 class="text-2xl ${LAB_ACCENT_TEXT[toy.accent]}"><span class="text-terminal-pink">$ </span>./${escapeHtml(toy.title)}</h1>
      <p class="text-sm text-terminal-gray">${escapeHtml(toy.desc)}</p>
      ${toy.how ? `<p class="text-sm text-terminal-gray/75 leading-relaxed"><span class="text-terminal-green"># 原理</span> ${escapeHtml(toy.how)}</p>` : ''}
      <div class="rounded-lg overflow-hidden border border-terminal-line/70 bg-terminal-panel/40">
        <div class="p-8 text-center text-sm text-terminal-gray/60">正在加载交互组件…</div>
      </div>
    </div>
  `;
}

// ---------- inspirations 小灵感 ----------
function inspirationsBody(items) {
  const cards = items
    .map(
      (i) => `<li class="py-4 border-b border-terminal-line/60">
        <div class="text-sm whitespace-pre-wrap text-terminal-gray">${escapeHtml(i.content)}</div>
        <div class="mt-2 text-xs text-terminal-gray/60 flex items-center gap-3">
          <span>${escapeHtml((i.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
          ${i.mood ? `<span class="text-terminal-yellow">${escapeHtml(i.mood)}</span>` : ''}
        </div>
      </li>`,
    )
    .join('\n');
  return `
    <div class="space-y-6">
      <h1 class="text-terminal-pink text-2xl"><span class="text-terminal-pink">$ </span>tail -f thoughts.log</h1>
      <p class="text-sm text-terminal-gray/70">随手记的小灵感 &amp; 闪念。</p>
      <ul>
${cards || '<li class="py-4 text-terminal-gray/60">空空如也。</li>'}
      </ul>
    </div>
  `;
}

// ---------- 站点 FAQ ----------
const SITE_FAQ = [
  ['这个站点是什么？', 'tenggouwa的极客小站，覆盖 AI 大模型 / Linux 系统 / 前端与工具的笔记、灵感与实验；另有前端实验室（跑在浏览器里的生成式小玩具）和反赌教育模拟器（用假积分跑真实赌场赔率，用数据讲清「长期必输」的数学）。'],
  ['作者是谁？', 'tenggouwa，一名软件工程师，写前端 / 后端 / 脚本 / 诗。联系邮箱 tenggouwa@gmail.com。'],
  ['技术栈 / 是否开源？', '整站是一个 monorepo：前端 Vite + React + TypeScript，挂 Cloudflare Pages / GitHub Pages；后端 FastAPI + PostgreSQL 自部署在云服务器。'],
  ['怎么订阅更新？', '订阅 RSS：/feed.xml。面向 LLM 的站点索引见 /llms.txt，全文合集见 /llms-full.txt。'],
  ['可以转载或被 AI 引用吗？', '欢迎搜索引擎与生成式 AI 引擎抓取并引用本站内容（见 robots.txt 与 /llms.txt 的显式声明）。'],
];

function faqBody() {
  const items = SITE_FAQ.map(
    ([q, a]) => `<div class="space-y-1">
        <dt class="text-terminal-yellow">${escapeHtml(q)}</dt>
        <dd class="text-sm text-terminal-gray/85 leading-relaxed">${escapeHtml(a)}</dd>
      </div>`,
  ).join('\n');
  return `
    <div class="space-y-6">
      <h1 class="text-terminal-green text-2xl"><span class="text-terminal-pink">$ </span>cat FAQ.md</h1>
      <dl class="space-y-4">
${items}
      </dl>
    </div>
  `;
}

function faqPageLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: SITE_FAQ.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

// ---------- 首页 ----------
// tenggouwa figlet（与 Home.tsx 的 ASCII 一致）。逐行单引号字面量，避开模板字符串
// 里反引号 / 反斜杠的转义坑。
const HOME_ASCII = [
  ' _',
  '| |_ ___ _ __   __ _  __ _  ___  _   ___      ____ _',
  '| __/ _ \\ \'_ \\ / _` |/ _` |/ _ \\| | | \\ \\ /\\ / / _` |',
  '| ||  __/ | | | (_| | (_| | (_) | |_| |\\ V  V / (_| |',
  ' \\__\\___|_| |_|\\__, |\\__, |\\___/ \\__,_| \\_/\\_/ \\__,_|',
  '               |___/ |___/',
].join('\n');

// 首页导航卡片：与 Home.tsx 的三大区块 + casino 对齐，纯文字/链接，爬虫首屏即拿到
const HOME_CARDS = [
  { to: '/posts/', title: 'posts/', desc: '技术 / 思考 / 折腾笔记' },
  { to: '/inspirations', title: 'inspirations/', desc: '随手记的小灵感 & 闪念' },
  { to: '/lab', title: 'lab/', desc: '跑在浏览器里的生成式小玩具' },
  { to: '/casino/', title: 'casino/', desc: '反赌教育模拟器：用假积分跑真赔率' },
];

function homeBody(posts) {
  const cards = HOME_CARDS.map(
    (c) => `<a href="${pageUrl(c.to)}" class="group block border border-terminal-line/70 bg-terminal-panel/50 rounded-lg p-5 transition-colors hover:border-terminal-green/60">
          <div class="text-terminal-green font-semibold mb-1">${escapeHtml(c.title)}</div>
          <div class="text-sm text-terminal-gray/80">${escapeHtml(c.desc)}</div>
        </a>`,
  ).join('\n        ');
  const latest = posts
    .slice(0, 5)
    .map(
      (p) => `<li class="py-3 border-b border-terminal-line/60">
          <a href="${pageUrl(`/posts/${p.slug}/`)}" class="group flex items-baseline justify-between gap-4">
            <span class="text-terminal-gray group-hover:text-terminal-green transition-colors">${escapeHtml(p.title)}</span>
            <span class="text-xs text-terminal-gray/60 shrink-0">${escapeHtml((p.publishedAt || '').slice(0, 10))}</span>
          </a>
        </li>`,
    )
    .join('\n        ');
  return `
    <div class="space-y-10">
      <pre class="text-terminal-green text-[10px] md:text-xs leading-tight overflow-x-auto shadow-glow">${escapeHtml(HOME_ASCII)}</pre>
      <p class="text-terminal-gray/85 leading-relaxed max-w-2xl">
        <span class="text-terminal-pink">~$</span> tenggouwa的极客小站 —— 一个写前端、写后端、写脚本、写诗的工程师。
        这里有 AI 大模型 / Linux 系统 / 前端与工具的笔记、灵感与实验。
      </p>
      <section class="grid md:grid-cols-2 gap-4">
        ${cards}
      </section>
      <section class="space-y-3">
        <h2 class="text-terminal-green text-lg"><span class="text-terminal-pink">$ </span>cat posts/*.md | head</h2>
        <ul>
        ${latest || '<li class="py-3 text-terminal-gray/60">空空如也。</li>'}
        </ul>
        <a href="${pageUrl('/posts/')}" class="text-sm text-terminal-cyan hover:underline">→ 全部文章</a>
      </section>
    </div>
  `;
}

// 与 apps/web/index.html 顶部的 SPA deep-link 还原脚本保持一致：预渲染覆盖首页
// index.html 后，build-pages.sh 会把它 cp 成 404.html，这段脚本必须随之保留，
// 否则子路径 SPA(admin/casino) 的兜底 bounce 无法还原原始 URL。
const SPA_REDIRECT_RESTORE = `<script>
      (function () {
        try {
          var r = sessionStorage.getItem('tg_spa_redirect');
          if (!r) return;
          sessionStorage.removeItem('tg_spa_redirect');
          if (r.indexOf('/Tenggouwa-site/') !== 0) return;
          if (r.indexOf('/Tenggouwa-site/admin/') === 0) return;
          if (r.indexOf('/Tenggouwa-site/casino/') === 0) return;
          if (r === location.pathname + location.search + location.hash) return;
          history.replaceState(null, '', r);
        } catch (e) {}
      })();
    </script>`;

// ---------- sitemap / robots / feed ----------
function buildSitemap(posts, tags, series = []) {
  const urls = [
    { loc: canonical('/'), changefreq: 'weekly', priority: '1.0' },
    { loc: canonical('/posts/'), changefreq: 'weekly', priority: '0.9' },
    { loc: canonical('/about'), changefreq: 'monthly', priority: '0.6' },
    { loc: canonical('/faq'), changefreq: 'monthly', priority: '0.5' },
    { loc: canonical('/inspirations'), changefreq: 'weekly', priority: '0.6' },
    { loc: canonical('/casino/'), changefreq: 'monthly', priority: '0.7' },
    ...series.map((t) => ({
      loc: canonical(`/series/${encodeURIComponent(t)}/`),
      changefreq: 'weekly',
      priority: '0.6',
    })),
    { loc: canonical('/lab'), changefreq: 'monthly', priority: '0.5' },
    ...LAB_TOYS.map((t) => ({
      loc: canonical(`/lab/${t.slug}`),
      changefreq: 'monthly',
      priority: '0.4',
    })),
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
    `- [反赌模拟器](${canonical('/casino/')}): 用假积分跑真实赌场赔率，用数据讲清「长期必输」的数学真相`,
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
  const inspirations = await collectInspirations();
  console.log(`==> ${inspirations.length} inspirations`);

  const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();

  // 详情页
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    // posts 是按时间倒序的；prev 表示更早一篇，next 表示更新一篇
    const next = posts[i - 1];
    const prev = posts[i + 1];
    const related = relatedPosts(post, posts, [prev, next]);
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
      bodyHtml: postDetailBody(post, { prev, next, related }),
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
        itemListLd(posts),
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

  // 系列聚合页（/series/<tag>）：被首页 / 列表 / 详情页三处内链指向
  const seriesGroups = new Map();
  for (const p of posts) {
    const s = seriesTagOf(p);
    if (!s) continue;
    if (!seriesGroups.has(s)) seriesGroups.set(s, []);
    seriesGroups.get(s).push(p);
  }
  for (const [tag, group] of seriesGroups) {
    // 系列内按发布时间升序 = 阅读顺序
    const ordered = group.slice().sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || ''));
    const label = seriesLabel(tag);
    writeFile(
      `series/${tag}/index.html`,
      shell({
        title: `${label} · tenggouwa`,
        description: `${label}：按发布顺序阅读的 ${ordered.length} 篇系列文章。`,
        currentPath: `/series/${tag}/`,
        jsonLd: [
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Posts', path: '/posts/' },
            { name: label, path: `/series/${tag}/` },
          ]),
          itemListLd(ordered, { name: label }),
        ],
        bodyHtml: seriesBody(ordered, label),
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
        description: meta.summary ?? '关于tenggouwa。',
        currentPath: '/about',
        jsonLd: [
          personLd(),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'About', path: '/about' },
          ]),
        ],
        bodyHtml: `<article class="prose prose-invert max-w-none">${renderMd(body)}</article>`,
      }),
    );
  }

  // /lab 列表 + 每个玩具的静态外壳（消掉深链接 404，SPA 挂载后接管）
  writeFile(
    'lab/index.html',
    shell({
      title: 'Lab',
      description: '前端实验室。跑在浏览器里的生成式小玩具：分形、反应扩散、boids、生命游戏等。',
      currentPath: '/lab',
      jsonLd: breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Lab', path: '/lab' },
      ]),
      bodyHtml: labListBody(),
    }),
  );
  for (const toy of LAB_TOYS) {
    writeFile(
      `lab/${toy.slug}/index.html`,
      shell({
        title: `${toy.title} · lab`,
        description: toy.desc,
        currentPath: `/lab/${toy.slug}`,
        jsonLd: breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Lab', path: '/lab' },
          { name: toy.title, path: `/lab/${toy.slug}` },
        ]),
        bodyHtml: labToyBody(toy),
      }),
    );
  }

  // inspirations 小灵感（短文本闪念，可索引）
  writeFile(
    'inspirations/index.html',
    shell({
      title: 'Inspirations · tenggouwa',
      description: '随手记的小灵感 & 闪念：关于工程、生活与折腾的短思。',
      currentPath: '/inspirations',
      jsonLd: breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Inspirations', path: '/inspirations' },
      ]),
      bodyHtml: inspirationsBody(inspirations),
    }),
  );

  // 站点 FAQ（作者 / 技术栈 / 订阅 / AI 引用），带 FAQPage 结构化数据
  writeFile(
    'faq/index.html',
    shell({
      title: 'FAQ · tenggouwa',
      description: '关于本站与作者的常见问题：这是什么、作者是谁、技术栈、如何订阅、能否被 AI 引用。',
      currentPath: '/faq',
      jsonLd: [
        faqPageLd(),
        breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'FAQ', path: '/faq' },
        ]),
      ],
      bodyHtml: faqBody(),
    }),
  );

  // 首页：最后写，避免覆盖 vite 的 index.html 影响前面各页读取 head 资源 / 入口脚本。
  // extraHead 带上 SPA deep-link 还原脚本（build-pages.sh 会把本文件 cp 成 404.html）。
  writeFile(
    'index.html',
    shell({
      title: SITE_TITLE,
      description: SITE_DESC,
      currentPath: '/',
      extraHead: SPA_REDIRECT_RESTORE,
      jsonLd: [websiteLd(), personLd()],
      bodyHtml: homeBody(posts),
    }),
  );

  // sitemap / robots / feed
  writeFile('sitemap.xml', buildSitemap(posts, allTags, [...seriesGroups.keys()]));
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
