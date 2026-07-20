import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages 部署需要 base path（仓库名）
// 假设仓库名为 wolf-coach-web；如不同请改这里
const BASE = process.env.GH_PAGES_BASE || '/wolf-coach-web/';

export default defineConfig({
  base: BASE,
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 本地开发时把 /api 和 /admin 代理到本地 Worker（默认 8787）
      '/api': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
    },
  },
});
