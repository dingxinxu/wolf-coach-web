import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 部署需要 base path（仓库名）
// 假设仓库名为 wolf-coach-web；如不同请改这里
const BASE = process.env.GH_PAGES_BASE || '/wolf-coach-web/';

export default defineConfig({
  base: BASE,
  plugins: [
    vue(),
    // P2-17：PWA 离线缓存（App Shell + 立绘 + skill md）
    VitePWA({
      registerType: 'autoUpdate',
      // GitHub Pages 子路径部署，base path 必须对齐
      base: BASE,
      includeAssets: ['role-art/*.webp', 'skill/**/*.md'],
      workbox: {
        // 预缓存：App Shell + 立绘 + 技能 md（首次访问后离线可看术语/FAQ/历史对局）
        globPatterns: ['**/*.{js,css,html,webp,md,png,svg,woff2}'],
        // 运行时缓存：LLM/SSE/STT 不缓存（动态接口）
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB（含原 PNG 版权证据）
      },
      manifest: {
        name: '狼人杀制胜教练',
        short_name: '狼人教练',
        description: '线下狼人杀对局实时教练',
        theme_color: '#050811',
        background_color: '#050811',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          {
            src: `${BASE}role-art/seer.webp`,
            sizes: '512x512',
            type: 'image/webp',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // 本地开发时把 /api 和 /admin 代理到本地 Worker（默认 8787）
      '/api': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.js'],
  },
});
