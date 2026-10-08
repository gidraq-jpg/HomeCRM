import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*', 'apps/server/vitest.perf.config.ts'],
  },
});
