#!/usr/bin/env node
// 给每篇文章生成 1200x630 OG 封面 PNG。
// 思路：手画一段 SVG 模板（终端风格，跟站点 design system 一致），
// 替换 title / slug / tags 占位，用 @resvg/resvg-js 渲成 PNG。
//
// 用法:
//   node scripts/generate-og.mjs --dist=<dir> --base=<base>
//
// 字体：默认 monospace fallback（系统 DejaVu Sans Mono / Menlo 等），
// CJK 字符在 Linux runner 上可能显示成豆腐方块。所以渲染时**优先用 slug**
// 作为主标题（slug 是英文）；中文文章标题作为副标题，没字体就退化为方块也无所谓
// （社交平台展示的是 og:title + og:image 一起，文字信息仍然能看）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

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
const CONTENT_DIR = path.join(ROOT, 'content/posts');

function parseFM(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      meta[k] = v.replace(/^['"]|['"]$/g, '');
    }
  }
  return meta;
}

function collectPosts() {
  const posts = [];
  if (!fs.existsSync(CONTENT_DIR)) return posts;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.md')) {
        const meta = parseFM(fs.readFileSync(p, 'utf-8'));
        if (!meta || !meta.slug) continue;
        if (meta.draft === 'true' || meta.draft === true) continue;
        posts.push({
          slug: meta.slug,
          title: meta.title ?? meta.slug,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
        });
      }
    }
  };
  walk(CONTENT_DIR);
  return posts;
}

function escXml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function svgTemplate({ title, slug, tags, isDefault = false }) {
  // 颜色跟 tailwind.config.ts 里 terminal 配色一致
  const bg = '#0b0f10';
  const green = '#5af78e';
  const cyan = '#57c7ff';
  const pink = '#ff6ac1';
  const gray = '#8a9199';

  const titleText = isDefault ? 'tenggouwa · 极客小站' : clip(slug, 48);
  const subtitle = isDefault
    ? '腾构娃的极客小站 · AI / 系统 / 工具的笔记、灵感与实验'
    : clip(title, 38);
  const tagsLine = tags.length ? `# ${tags.slice(0, 4).join('  # ')}` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g1" cx="20%" cy="0%" r="60%">
      <stop offset="0%" stop-color="${cyan}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${cyan}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="80%" cy="100%" r="55%">
      <stop offset="0%" stop-color="${green}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${green}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${bg}"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>

  <!-- top bar like terminal prompt -->
  <text x="60" y="110" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="28" fill="${pink}">~$</text>
  <text x="110" y="110" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="28" fill="${green}">tenggouwa.com</text>

  <!-- divider -->
  <line x1="60" y1="140" x2="1140" y2="140" stroke="#1f2a30" stroke-width="1"/>

  <!-- title (slug or site name) -->
  <text x="60" y="260" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" font-size="74" fill="${green}">
    ${escXml(titleText)}
  </text>

  <!-- subtitle (post title or slogan) -->
  <text x="60" y="360" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="34" fill="#c5cbd3">
    ${escXml(subtitle)}
  </text>

  <!-- tags -->
  <text x="60" y="510" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="26" fill="${cyan}">
    ${escXml(tagsLine)}
  </text>

  <!-- footer -->
  <text x="60" y="570" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" fill="${gray}">
    ~$ cat ${escXml(isDefault ? 'about.md' : `posts/${slug}.md`)}
  </text>

  <!-- blinking cursor -->
  <rect x="${60 + (isDefault ? 200 : 220 + slug.length * 12)}" y="552" width="14" height="22" fill="${green}"/>
</svg>`;
}

function renderToPng(svg) {
  const resvg = new Resvg(svg, {
    background: '#0b0f10',
    fitTo: { mode: 'width', value: 1200 },
    font: {
      // 系统 fallback；不嵌字体，避免膨胀
      loadSystemFonts: true,
      defaultFontFamily: 'monospace',
    },
  });
  return resvg.render().asPng();
}

function writeFile(rel, buf) {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  console.log(`  ✓ ${rel} (${(buf.length / 1024).toFixed(0)}kb)`);
}

function main() {
  if (!fs.existsSync(DIST)) {
    throw new Error(`dist not found: ${DIST}`);
  }
  console.log(`==> generating OG images into ${DIST}/og/`);

  // 默认 OG（首页、列表页、标签聚合页等共用）
  writeFile('og-default.png', renderToPng(svgTemplate({ isDefault: true, title: '', slug: '', tags: [] })));

  // 每篇文章独立 OG
  const posts = collectPosts();
  for (const p of posts) {
    writeFile(`og/${p.slug}.png`, renderToPng(svgTemplate({ title: p.title, slug: p.slug, tags: p.tags })));
  }
  console.log(`==> done: ${posts.length + 1} images`);
}

main();
