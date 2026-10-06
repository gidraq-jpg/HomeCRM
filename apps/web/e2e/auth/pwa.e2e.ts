import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn } from './support/helpers.ts';

test('manifest и значки установки; инструкция для телефона', async ({ page, family }, info) => {
  await page.goto('#/sign-in');
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = (await (
    await page.request.get(new URL(href ?? '', page.url()).href)
  ).json()) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(['192x192', '512x512']);
  for (const icon of manifest.icons) {
    expect(icon.purpose).toContain('maskable');
    const result = await page.request.get(`${family.baseURL}${icon.src}`);
    expect(result.status()).toBe(200);
    expect(result.headers()['content-type']).toBe('image/png');
  }
  await page.getByRole('button', { name: 'Установить на телефон' }).click();
  await expect(page.getByRole('status')).toContainText('На iPhone: Safari');
  await checkAuth(page, info, 'install');
});

test('«Установить на телефон»: на входе и в настройках, не на «Сегодня» и не под нижним меню', async ({
  page,
  family,
}, info) => {
  const install = page.getByRole('button', { name: 'Установить на телефон' });
  await page.goto('#/sign-in');
  await expect(install).toBeVisible();
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await expect(install).toHaveCount(0);
  await page.goto('#/more/settings');
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await expect(install).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Приложение на телефоне' })).toBeVisible();
  await checkAuth(page, info, 'install-settings');
});

test('без сети видна плашка, форма недоступна, после подключения вход работает', async ({
  page,
  family,
  context,
}, info) => {
  await page.goto('#/sign-in');
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Без сети', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeDisabled();
  await checkAuth(page, info, 'offline');
  await context.setOffline(false);
  await expect(page.getByText('Без сети', { exact: true })).toHaveCount(0);
  await signIn(page, family, 'child');
  await expectSignedIn(page);
});

test('service worker кэширует оболочку, API и токены не кэширует; холодный офлайн', async ({
  page,
  family,
  context,
}) => {
  await page.goto('#/sign-in');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  const keys = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result.push(...(await cache.keys()).map((request) => request.url));
    }
    return result;
  });
  expect(keys.some((url) => /\/api\//.test(url))).toBe(false);
  expect(keys.some((url) => url.includes('token='))).toBe(false);
  expect(keys.some((url) => url.includes('index.html'))).toBe(true);
  expect(keys.some((url) => url.includes('/assets/'))).toBe(true);
  const stored = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response?.headers.get('content-type')?.includes('json'))
          result.push(await response.text());
      }
    }
    return result.join('');
  });
  expect(stored.includes(family.person('child').password)).toBe(false);
  expect(stored.includes('session_token')).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Без сети', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Не удалось проверить вход' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
});
