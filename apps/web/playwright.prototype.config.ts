import { defineConfig } from '@playwright/test';
import { E2E_PORT, E2E_PREFIX } from './e2e/support/static-server.ts';

// Сквозные тесты прототипа навигации (задача 0.5): Playwright и axe на ширине 360 и 412 px.
// Прототип — отдельная сборка (`vite build --mode prototype`, папка dist-prototype) на вымышленных
// данных, без входа и сервера. Образец экранов для R0.4b, R1a и дальше. Запуск —
// `pnpm test:e2e:prototype`; в CI не входит. Статический сервер отдаёт сборку из подпапки
// на свободном порту (по умолчанию 5194, меняется через E2E_PORT).

const baseURL = `http://127.0.0.1:${E2E_PORT}${E2E_PREFIX}`;

const phone = {
  browserName: 'chromium',
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

export default defineConfig({
  testDir: './e2e/prototype',
  testMatch: '**/*.e2e.ts',
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
