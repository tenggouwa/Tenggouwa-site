#!/usr/bin/env node
// casino 游戏页预渲染：给 16 个 /casino/games/<slug> 路由各生成一份可索引的静态
// HTML 壳（首屏文字 + Game / FAQPage JSON-LD），React createRoot 挂载后接管。
//
// 为什么单独一个脚本：casino 是独立 vite app（自己的 base / CSS / entry bundle），
// 跟 scripts/prerender.mjs（web app）的 head 资源不通用，硬塞进去会互相污染。
//
// 用法（在 build-pages.sh 里，web prerender 之后调用，此时 $DIST/casino/index.html
// 与 $DIST/sitemap.xml 都已就绪）：
//   node scripts/prerender-casino.mjs --dist=<dir> --base=/casino/ --origin=https://tenggouwa.com [--noindex]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ORIGIN = (args.origin ?? 'https://tenggouwa.com').replace(/\/$/, '');
const NOINDEX = Boolean(args.noindex);
// casino 内部链接用的 base（跟 build-pages.sh 的 CASINO_BASE 一致）；末尾带 /
let BASE = String(args.base ?? '/casino/');
if (!BASE.endsWith('/')) BASE += '/';

// 与 apps/casino/src/pages/Lobby.tsx 的 GAMES 保持同步：slug 用路由名（连字符），
// edge/desc 照抄，改了 Lobby 记得两边一起改。
const GAMES = [
  { slug: 'baccarat', name: '百家乐 · Baccarat', edge: '1.06%', desc: '押庄 / 闲 / 和，标准补牌规则。押庄优势最低 1.06%，但押「和」是 14.4% 的陷阱。' },
  { slug: 'blackjack', name: '21点 · Blackjack', edge: '~0.5%', desc: '要牌 / 停牌 / 双倍，最讲策略的牌局。基本策略庄家优势仅 0.5%，但乱玩照样把你磨光。' },
  { slug: 'videopoker', name: '视频扑克 · Video Poker', edge: '~0.5%', desc: '发 5 张留牌换牌，按牌型赔付。返还率最高的机器，但最优解仍是负期望，乱留更亏。' },
  { slug: 'mines', name: 'Mines · 扫雷', edge: '2.00%', desc: '翻格避雷，倍率随翻随涨，随时兑现，踩雷归零。「再翻一个」的侥幸最致命。' },
  { slug: 'niuniu', name: '牛牛 · 斗牛', edge: '2.46%', desc: '闲庄各 5 张比牛，牛大者赢。牌对半开，赢了就抽 5% 水——公平外壳下的稳定刮刀。' },
  { slug: 'zhajinhua', name: '炸金花 · 赢三张', edge: '2.5%', desc: '华人最火的牌局：闲庄各 3 张比牌型，豹子最大。看着公平，水钱照样磨光你。' },
  { slug: 'roulette', name: '轮盘 · Roulette', edge: '2.70%', desc: '欧式单零轮盘，37 格。押红黑 / 单双 / 大小或单个号码，那个 0 让你永远差一口气。' },
  { slug: 'dice', name: '骰子 · 大小', edge: '2.78%', desc: '三颗骰子押大小，豹子通杀。最简单的概率游戏，最直接的庄家优势。' },
  { slug: 'sicbo', name: '骰宝 · Sic Bo', edge: '2.78%', desc: '完整三骰：大小 / 单点 / 总和 / 豹子。大小优势最低，高赔率项个个是坑。' },
  { slug: 'dragon-tiger', name: '龙虎斗 · Dragon Tiger', edge: '3.85%', desc: '龙虎各一张比大小，押龙 / 虎 / 和。一秒一局，押「和」是 30% 优势的陷阱。' },
  { slug: 'crash', name: '崩盘 · Crash', edge: '4.00%', desc: '倍率不断上涨，到目标自动兑现，崩了归零。越贪越易崩——现代网赌的成瘾钩子。' },
  { slug: 'plinko', name: 'Plinko · 落球', edge: '4.00%', desc: '小球穿 12 排钉落进倍率格。中间 ×0.25 概率最高，边缘 ×50 几乎不可能。' },
  { slug: 'slots', name: '老虎机 · Slots', edge: '6.04%', desc: '三轴卷轴，看似随机，赔率早已写死。RTP 93.96%，命中率约 11.6%——大多数拉杆就是亏。' },
  { slug: 'money-wheel', name: '幸运大转盘 · Money Wheel', edge: '11–24%', desc: '54 格钱轮，押 1/2/5/10/20/40/★。格上数字越大赔率越高、抽水也越狠。' },
  { slug: 'keno', name: '基诺 · Keno', edge: '~28%', desc: '从 80 个号选 1–10 个，机开 20 个对中。庄家优势全场最高，用大头奖掩盖极差期望。' },
  { slug: 'scratch', name: '刮刮乐 · Scratch', edge: '~43%', desc: '即开彩票，刮 9 格三连中奖。庄家优势全场最高，用万分之一的大奖撑起最差的期望。' },
];

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const canonical = (slug) => `${ORIGIN}/casino/games/${slug}/`;

// 从 casino 构建产物 index.html 抓 CSS / modulepreload / entry module 脚本（原样复用）。
function casinoHeadAndScript() {
  const idxPath = path.join(DIST, 'casino', 'index.html');
  if (!fs.existsSync(idxPath)) {
    throw new Error(`expected casino build output at ${idxPath}`);
  }
  const html = fs.readFileSync(idxPath, 'utf-8');
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>/g)].map((m) => m[0]);
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+>/g)].map((m) => m[0]);
  const scriptMatch = html.match(/<script[^>]+type="module"[^>]+src="[^"]+"[^>]*>\s*<\/script>/);
  if (!scriptMatch) throw new Error(`casino entry module script not found in ${idxPath}`);
  return { head: [...links, ...preloads].join('\n    '), script: scriptMatch[0] };
}

function gameLd(g) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Game',
    name: g.name,
    url: canonical(g.slug),
    inLanguage: 'zh-CN',
    genre: '赌场游戏 / 概率教育',
    gamePlatform: 'Web Browser',
    description: g.desc,
    isPartOf: {
      '@type': 'SoftwareApplication',
      name: '赌场真相 · 反赌教育模拟器',
      url: `${ORIGIN}/casino/`,
    },
    author: { '@type': 'Person', name: 'tenggouwa', url: ORIGIN },
  };
}

function faqLd(g) {
  const qa = [
    [`${g.name}的庄家优势是多少？`, `${g.name}的理论庄家优势约 ${g.edge}。长期每下注 100 分，平均净送给庄家的比例就是这个数——这是写死在规则里的负期望。`],
    [`玩${g.name}能长期赢钱吗？`, `不能。${g.edge} 的庄家优势是负期望，短期靠方差可能赢，但玩得越多越会被大数定律拉回庄家一侧。没有能翻盘的下注策略。`],
    [`${g.name}怎么玩？`, g.desc],
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

function breadcrumbLd(g) {
  const items = [
    { name: '赌场真相', url: `${ORIGIN}/casino/` },
    { name: '游戏', url: `${ORIGIN}/casino/` },
    { name: g.name, url: canonical(g.slug) },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

function gamePage(g, { head, script }) {
  const robots = NOINDEX
    ? '<meta name="robots" content="noindex" />'
    : '<meta name="robots" content="index,follow,max-image-preview:large" />';
  const ld = [gameLd(g), faqLd(g), breadcrumbLd(g)]
    .map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`)
    .join('\n    ');
  const title = `${g.name} 庄家优势 ${g.edge} · 赌场真相`;
  const desc = `${g.name}：理论庄家优势约 ${g.edge}。${g.desc}`;
  return `<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${canonical(g.slug)}" />
    ${robots}
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(g.name)} · 赌场真相" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${canonical(g.slug)}" />
    <meta property="og:image" content="${ORIGIN}/og-default.png" />
    ${head}
    ${ld}
  </head>
  <body class="bg-terminal-bg text-terminal-gray font-mono">
    <!-- GEO 静态壳：不执行 JS 的爬虫拿到的首屏文本；React createRoot 挂载后整体替换 #root。 -->
    <div id="root">
      <main class="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <nav class="text-xs text-terminal-gray/70 flex items-center gap-2">
          <a class="hover:text-terminal-green" href="${BASE}">赌场真相</a>
          <span class="text-terminal-line">/</span>
          <span class="text-terminal-gray/80">games/${escapeHtml(g.slug)}</span>
        </nav>
        <header class="space-y-1">
          <h1 class="text-2xl font-semibold text-terminal-green">${escapeHtml(g.name)}</h1>
          <div class="text-sm text-terminal-gray/80">庄家优势 <span class="text-terminal-red">${escapeHtml(g.edge)}</span></div>
        </header>
        <p class="text-sm leading-relaxed text-terminal-gray/85">${escapeHtml(g.desc)}</p>
        <section class="space-y-2">
          <h2 class="text-lg text-terminal-green">为什么长期必输</h2>
          <p class="text-sm leading-relaxed text-terminal-gray/85">
            ${escapeHtml(g.name)}的庄家优势约 <span class="text-terminal-pink">${escapeHtml(g.edge)}</span>，这是写死在规则里的负期望。
            短期方差会让你赢或输，但下注额 × 庄家优势 = 长期平均每局送给庄家的钱，玩得越多这笔账越准——
            这就是大数定律，跟运气与技巧无关，也没有能翻盘的下注策略。
          </p>
        </section>
        <nav class="border-t border-terminal-line/60 pt-4 text-sm flex flex-wrap gap-x-5 gap-y-1 text-terminal-gray/70">
          <a class="hover:text-terminal-green" href="${BASE}">← 返回大厅</a>
          <a class="hover:text-terminal-green" href="${BASE}truth">全站庄家优势排行榜</a>
          <a class="hover:text-terminal-green" href="https://tenggouwa.com/">tenggouwa.com</a>
        </nav>
      </main>
    </div>
    ${script}
  </body>
</html>
`;
}

// 把 casino 游戏 URL 追加进 web prerender 已写好的 sitemap.xml（插在 </urlset> 前）。
function appendSitemap() {
  const smPath = path.join(DIST, 'sitemap.xml');
  if (!fs.existsSync(smPath)) {
    console.warn(`  (sitemap.xml 不存在，跳过 casino 游戏 URL 追加)`);
    return;
  }
  const xml = fs.readFileSync(smPath, 'utf-8');
  const entries = GAMES.map(
    (g) =>
      `  <url>\n    <loc>${canonical(g.slug)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`,
  ).join('\n');
  const out = xml.replace('</urlset>', `${entries}\n</urlset>`);
  fs.writeFileSync(smPath, out);
  console.log(`  ✓ sitemap.xml += ${GAMES.length} casino 游戏 URL`);
}

function main() {
  const casinoDir = path.join(DIST, 'casino');
  if (!fs.existsSync(casinoDir)) {
    throw new Error(`casino 产物目录不存在：${casinoDir}（应在 build-pages.sh 拷贝 casino 之后运行）`);
  }
  console.log(`==> 预渲染 casino 游戏页 into ${casinoDir} (base=${BASE}, origin=${ORIGIN}, noindex=${NOINDEX})`);
  const assets = casinoHeadAndScript();
  for (const g of GAMES) {
    const full = path.join(casinoDir, 'games', g.slug, 'index.html');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, gamePage(g, assets));
    console.log(`  ✓ casino/games/${g.slug}/index.html`);
  }
  appendSitemap();
  console.log('==> casino done');
}

main();
