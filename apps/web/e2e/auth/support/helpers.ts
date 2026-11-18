import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  SCREENSHOT_DIR,
  settle,
  widthOf,
} from '../../support/helpers.ts';
import type { Family } from './family.ts';
import { expect } from './fixtures.ts';

export async function signIn(
  page: Page,
  family: Family,
  role: 'admin' | 'adult' | 'child',
  email = false,
) {
  await page.goto('#/sign-in');
  await page.getByLabel('Имя пользователя или почта').fill(email ? `${role}@family.test` : role);
  await page.getByLabel('Пароль', { exact: true }).fill(family.person(role).password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
/**
 * Ждёт конца фоновой подгрузки разделов после входа (prefetch.ts) и остальных начатых запросов
 * к API. Вызывается до входа, возвращает ожидание. Нужна перед действием, которое меняет сессию:
 * запрос со старой сессией, обработанный сервером после смены, получает 401 и стирает cookie.
 */
export function trackApi(page: Page): () => Promise<void> {
  const pending = new Set<unknown>();
  const isApi = (url: string) => new URL(url).pathname.startsWith('/api/');
  page.on('request', (request) => {
    if (isApi(request.url())) pending.add(request);
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => pending.delete(request));
  const prefetched = Promise.all(
    ['/api/objects', '/api/documents', '/api/contacts'].map((path) =>
      page.waitForResponse((response) => new URL(response.url()).pathname === path),
    ),
  );
  return async () => {
    await prefetched;
    await expect.poll(() => pending.size, 'начатые запросы к API завершены').toBe(0);
  };
}
/** `prefix` — начало имени файла скриншота: `auth` для экранов входа, `app` для рабочего приложения. */
export async function checkAuth(page: Page, info: TestInfo, name: string, prefix = 'auth') {
  await settle(page);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, `${name} (${widthOf(info)} px)`);
  const directory = resolve(SCREENSHOT_DIR, String(widthOf(info)));
  mkdirSync(directory, { recursive: true });
  // Даже вымышленные секреты не записываются в скриншоты. Пустые поля остаются видимыми.
  const mask = [page.locator('.auth-secret, .backup-grid, .authenticator img, textarea[readonly]')];
  for (const input of await page.locator('input[name*="assword"], input[name="code"]').all()) {
    if (await input.inputValue()) mask.push(input);
  }
  const viewport = page.viewportSize();
  // Для длинного профиля растягиваем окно, как в старых сценариях: липкая шапка сверху,
  // нижнее меню внизу, маски стоят на своих полях, а не на месте после прокрутки.
  if (viewport && (await page.locator('.app').count())) {
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ ...viewport, height: Math.max(viewport.height, height) });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  try {
    await page.screenshot({
      path: resolve(directory, `${prefix}-${name}.png`),
      fullPage: true,
      mask,
      maskColor: '#e9eee7',
    });
  } finally {
    if (viewport) await page.setViewportSize(viewport);
    // Возврат окна к прежней высоте приложение принимает за открытую экранную клавиатуру и прячет
    // нижнее меню и «+». Это побочный эффект снимка, а не поведение человека: возвращаем меню.
    await page.evaluate(async () => {
      // Событие изменения окна приходит после возврата размера, поэтому ждём его и только потом снимаем отметку.
      await new Promise((resolve) => setTimeout(resolve, 150));
      delete document.documentElement.dataset.keyboard;
    });
  }
}
export async function expectSignedIn(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
}
