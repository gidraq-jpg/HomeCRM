import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // На Windows 15 forks одновременно нагружают PostgreSQL и нативное хэширование Node.
    maxWorkers: process.platform === 'win32' ? Math.min(4, availableParallelism()) : undefined,
    projects: ['apps/*', 'packages/*', 'tools/*', 'apps/server/vitest.perf.config.ts'],
  },
});
