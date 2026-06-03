import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePluginForArco } from '@arco-plugins/vite-react';
import path from 'node:path';

// GitHub Pages 部署在仓库子路径下，通过 VITE_BASE 注入（CI 里设为 "/Tenggouwa-site/"）。
// 本地开发与 preview 默认走 "/"。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE ?? '/';
  const apiTarget = env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:10095';

  return {
    base,
    // 按用到的 Arco 组件（ConfigProvider/Tag/Empty）自动注入对应 CSS，
    // 替代 index.css 里的全量 arco.css，token 层由插件按需带入。
    plugins: [react(), vitePluginForArco({ style: 'css' })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,  // 转发 WebSocket（终端用）
        },
      },
    },
    build: {
      outDir: 'dist',
      // 开 sourcemap：浏览器只在 devtools 打开时才 fetch .map，普通访客零成本，
      // 但生产出错时 Sentry / DevTools 能拿到真实栈，省下大量"猜 minified 变量名"
      // 的时间。同时让 Lighthouse 的 valid-source-maps 这项通过。
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight', 'remark-math', 'rehype-katex', 'katex'],
            arco: ['@arco-design/web-react'],
            xterm: ['@xterm/xterm', '@xterm/addon-fit'],
          },
        },
      },
    },
  };
});
