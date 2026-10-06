import { defineConfig } from '@playwright/test';
import { E2E_PORT, E2E_PREFIX } from './e2e/support/static-server.ts';

// Сквозные тесты прототипа (задача 0.5): Playwright и axe на ширине 360 и 412 px.
// Запуск — отдельной командой `pnpm test:e2e`, в `pnpm check` они не входят: Playwright
// в CI появится в R0.3. Тесты идут по собранному `dist`, который отдаёт статический сервер
// из подпапки на свободном порту (по умолчанию 5194, меняется через E2E_PORT).

const baseURL = `http://127.0.0.1:${E2E_PORT}${E2E_PREFIX}`;

const phone = {
  browserName: 'chromium',
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/auth/support/global-setup.ts',
  workers: 2,
  timeout: 45_000,
  // Скриншоты экранов лежат рядом, в test-results/screens: эта папка не очищается перед прогоном.
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: 'light',
    serviceWorkers: 'allow',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'w360', use: { ...phone, viewport: { width: 360, height: 740 } } },
    { name: 'w412', use: { ...phone, viewport: { width: 412, height: 915 } } },
  ],
  webServer: {
    command: 'node e2e/support/static-server.ts',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
