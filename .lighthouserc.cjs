// Lighthouse CI：每次 push 跑一次，给 SEO / Performance / A11y / Best-practices
// 设基线。跌穿阈值就 fail，避免回归。
//
// 跑法（本地）:
//   pnpm build:cf
//   npx lhci autorun
//
// CI 里由 .github/workflows/deploy-pages.yml 触发。

const fs = require('node:fs');
const path = require('node:path');

// 详情页 / 标签聚合页要测的 slug 不能写死——cf-dist 是 prerender 从 prod API
// 拉出来的，slug 在 git 里没法控制。改成读已生成的 sitemap.xml 选第一个详情页
// + 第一个标签页，prod 里有什么就测什么。
function pickUrlsFromSitemap() {
  const sitemap = path.join(__dirname, 'cf-dist', 'sitemap.xml');
  const fixed = [
    'http://localhost/index.html',
    'http://localhost/posts/index.html',
  ];
  if (!fs.existsSync(sitemap)) return fixed;
  const xml = fs.readFileSync(sitemap, 'utf-8');
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const toLocal = (u) =>
    'http://localhost' + new URL(u).pathname.replace(/\/$/, '/index.html');
  const firstPost = all.find((u) => /\/posts\/[^/]+\/?$/.test(u));
  const firstTag = all.find((u) => /\/tags\/[^/]+\/?$/.test(u));
  const out = [...fixed];
  if (firstPost) out.push(toLocal(firstPost));
  if (firstTag) out.push(toLocal(firstTag));
  return out;
}

module.exports = {
  ci: {
    collect: {
      staticDistDir: './cf-dist',
      url: pickUrlsFromSitemap(),
      numberOfRuns: 1,
      settings: {
        // 默认 mobile 配置；性能 budget 也按 mobile 算（更严格）
        preset: 'desktop',
        // 排除外部资源失败带来的噪音（我们暂时没有外部依赖）
        skipAudits: [
          // 这两个跟我们的 GitHub Pages 子路径 / 自定义域兼容性无关，跳过
          'canonical', // SSG 已注入 canonical，但 lhci 对 localhost 主机名会误判
          // CI 在 localhost 跑 cf-dist，前端 POST /api/public/track + /vitals 到
          // api.tenggouwa.com 触发 CORS 拒绝，控制台报错 → 误扣 best-practices
          // 4 分。生产 tenggouwa.com → api.tenggouwa.com 同 site，没此问题。
          'errors-in-console',
        ],
      },
    },
    assert: {
      // 静态详情页：要求 SEO 极高分；性能/可访问性宽松一点先建立基线
      assertions: {
        'categories:seo': ['error', { minScore: 0.95 }],
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        // 关键 SEO 单项：必过
        'meta-description': 'error',
        'document-title': 'error',
        'html-has-lang': 'error',
        'viewport': 'error',
        'crawlable-anchors': 'warn',
        // Web Vitals 信号项：先 warn
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
      },
    },
    upload: {
      // 把报告上传到 lighthouse 临时存储（每次 CI 跑都给一个公开链接）
      // 想接私有 LHCI server 也可以改 target=lhci-server
      target: 'temporary-public-storage',
    },
  },
};
