// Lighthouse CI：每次 push 跑一次，给 SEO / Performance / A11y / Best-practices
// 设基线。跌穿阈值就 fail，避免回归。
//
// 跑法（本地）:
//   pnpm build:cf
//   npx lhci autorun
//
// CI 里由 .github/workflows/deploy-pages.yml 触发。
module.exports = {
  ci: {
    collect: {
      staticDistDir: './cf-dist',
      // 覆盖典型路径：首页（SPA）、列表页（静态）、详情页（静态）、标签聚合（静态）
      url: [
        'http://localhost/index.html',
        'http://localhost/posts/index.html',
        'http://localhost/posts/world-models/index.html',
        'http://localhost/tags/ai/index.html',
      ],
      numberOfRuns: 1,
      settings: {
        // 默认 mobile 配置；性能 budget 也按 mobile 算（更严格）
        preset: 'desktop',
        // 排除外部资源失败带来的噪音（我们暂时没有外部依赖）
        skipAudits: [
          // 这两个跟我们的 GitHub Pages 子路径 / 自定义域兼容性无关，跳过
          'canonical', // SSG 已注入 canonical，但 lhci 对 localhost 主机名会误判
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
