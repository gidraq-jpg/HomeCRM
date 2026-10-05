import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Сервер разработки — только на 127.0.0.1; API разработки — на 8310 (apps/server/src/config.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8310',
      '/health': 'http://127.0.0.1:8310',
    },
  },
});
