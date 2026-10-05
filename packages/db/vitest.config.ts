import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    // PostgreSQL 18 поднимается, только если в прогоне есть тесты этого пакета.
    globalSetup: ['./src/testing/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
