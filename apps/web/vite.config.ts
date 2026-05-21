import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// GitHub Pages 部署在仓库子路径下，通过 VITE_BASE 注入（CI 里设为 "/Tenggouwa-site/"）。
// 本地开发与 preview 默认走 "/"。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE ?? '/';
  const apiTarget = env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:10095';

  return {
    base,
    plugins: [react()],
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
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
  };
});
