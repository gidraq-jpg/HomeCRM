import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    // Тестам входа нужна настоящая PostgreSQL 18 с политиками RLS (ADR-0004, ADR-0005): свой сервер
    // на прогон пакета, своя база на каждый файл тестов. Подготовку делает пакет db.
    globalSetup: ['../../packages/db/src/testing/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
