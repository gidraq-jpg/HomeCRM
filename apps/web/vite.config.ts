import { env } from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Сервер разработки — только на 127.0.0.1. Порты по умолчанию: клиент 5173, API 8310
// (apps/server/src/config.ts). В отдельном worktree задайте свои: WEB_PORT и PORT (AGENTS.md).
const webPort = Number(env.WEB_PORT ?? 5173);
const api = `http://127.0.0.1:${env.PORT ?? 8310}`;

export default defineConfig({
  // По умолчанию — корень сайта: ссылки сервера /invite/... и /reset-password должны
  // открываться сразу. WEB_BASE позволяет собрать оболочку для заданной подпапки.
  base: env.WEB_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'] },
      manifest: {
        name: 'HomeCRM — дом и личное',
        short_name: 'HomeCRM',
        lang: 'ru',
        description: 'Семейные дела, документы и дом',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f7f7f2',
        theme_color: '#f7f7f2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  build: {
    // Значки Phosphor тянут все начертания, сборка больше 500 КБ; для прототипа это терпимо
    // (около 155 КБ после сжатия), а предупреждение только шумит.
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': api,
      '/health': api,
    },
  },
});
