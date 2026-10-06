import { defineConfig } from '@playwright/test';

// Сквозные тесты рабочего приложения: настоящий сервер и PostgreSQL на каждый сценарий
// (e2e/auth/support/family.ts), Playwright и axe на ширине 360 и 412 px, а экраны компьютера —
// на 1280 px. Запуск — `pnpm test:e2e:auth`; прототип навигации проверяется отдельной
// конфигурацией (playwright.prototype.config.ts, `pnpm test:e2e:prototype`).

const phone = {
  browserName: 'chromium',
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  testIgnore: '**/prototype/**',
  globalSetup: './e2e/auth/support/global-setup.ts',
  workers: 2,
  timeout: 45_000,
  // Скриншоты экранов лежат рядом, в test-results/screens: эта папка не очищается перед прогоном.
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
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
});
