import { expectAccessible, expectNoHorizontalScroll, screenshot } from '../support/helpers.ts';
import { expect, test } from './support/fixtures.ts';
import { checkAuth } from './support/helpers.ts';

const SESSION_REQUEST = '**/api/auth/get-session*';

test('заставка показывает логотип до ответа о сессии и передаёт управление экрану входа', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const session = Promise.withResolvers<void>();
  await page.route(SESSION_REQUEST, async (route) => {
    await session.promise;
    await route.continue();
  });

  const splash = page.locator('#boot-splash');
  const brand = splash.locator('.boot-word');
  try {
    await page.goto('#/sign-in');
    await expect(splash).toBeVisible();
    await expect(brand).toHaveText('homecrm.');
    await expect(brand).toHaveCSS('opacity', '1');
    await expect(splash).not.toHaveAttribute('data-state', 'closing');
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'заставка HomeCRM');
    await screenshot(page, info, 'auth-boot-splash', 'viewport');
  } finally {
    session.resolve();
  }

  await expect(splash).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  await checkAuth(page, info, 'boot-splash-login');
});

test('уменьшение движения показывает статичный логотип и освобождает экран при ошибке сессии', async ({
  page,
}) => {
  const session = Promise.withResolvers<void>();
  await page.route(SESSION_REQUEST, async (route) => {
    await session.promise;
    await route.fulfill({ status: 503 });
  });

  const splash = page.locator('#boot-splash');
  try {
    await page.goto('#/sign-in');
    await expect(splash).toBeVisible();
    await expect(splash.locator('.boot-mark')).toHaveCSS('animation-name', 'none');
    await expect(splash.locator('.boot-word')).toHaveCSS('opacity', '1');
  } finally {
    session.resolve();
  }

  await expect(splash).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Не удалось проверить вход' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeEnabled();
});
