import { defineProject } from 'vitest/config';

// Замеры скорости с порогами по реальному времени (PRD, раздел 13) идут отдельным проектом:
// - после всех остальных проектов (groupOrder), когда параллельные тесты не занимают процессор и PostgreSQL;
// - по одному файлу и одному воркеру: замеры не мешают друг другу.
// Порог не ослаблен: цель 300 мс та же, меняются только условия замера.
export default defineProject({
  test: {
    name: 'perf',
    include: ['src/**/*.perf.test.ts'],
    globalSetup: ['../../packages/db/src/testing/global-setup.ts'],
    sequence: { groupOrder: 1 },
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
