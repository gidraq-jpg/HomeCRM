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
  }
}
export async function expectSignedIn(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
}
