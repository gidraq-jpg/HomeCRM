import { env } from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Сервер разработки — только на 127.0.0.1. Порты по умолчанию: клиент 5173, API 8310
// (apps/server/src/config.ts). В отдельном worktree задайте свои: WEB_PORT и PORT (AGENTS.md).
const webPort = Number(env.WEB_PORT ?? 5173);
const api = `http://127.0.0.1:${env.PORT ?? 8310}`;

export default defineConfig({
  plugins: [react()],
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
