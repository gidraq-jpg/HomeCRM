import { randomBytes } from 'node:crypto';
import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn } from './support/helpers.ts';

test('профиль: свои устройства и журнал; независимая ошибка блока', async ({
  page,
  family,
}, info) => {
  await signIn(page, family, 'adult');
  await expectSignedIn(page);
  let release: () => void = () => {};
  const wait = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/api/auth/list-sessions', (route) =>
    route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }),
  );
  await page.route('**/api/login-events', async (route) => {
    await wait;
    await route.continue();
  });
  try {
    await page.goto('#/more/settings');
    await expect(page.getByText('Загружаем журнал…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить загрузку устройств' })).toBeVisible();
    await checkAuth(page, info, 'profile-error');
    release();
    await expect(page.getByText('Вход · Успешно')).toBeVisible();
    await page.unroute('**/api/auth/list-sessions');
    await page.getByRole('button', { name: 'Повторить загрузку устройств' }).click();
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(1);
    // Даты — «5 окт., 08:52» в часовом поясе дома, год только если он не текущий (PRD 13).
    await expect(page.getByText(/^Вход: \d{1,2} [а-я]+\., \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByText(/^До: \d{1,2} [а-я]+\.( \d{4})?, \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByText(/^\d{1,2} [а-я]+\., \d\d:\d\d · /).first()).toBeVisible();
    await expect(page.getByText(/^Вход: .*\d{4}/)).toHaveCount(0);
    await checkAuth(page, info, 'profile');
  } finally {
    release();
  }
});

test('смена пароля требует текущий пароль', async ({ page, family }) => {
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  const section = page
    .getByRole('heading', { name: 'Сменить пароль', exact: true })
    .locator('..')
    .locator('..');
  const password = randomBytes(18).toString('base64url');
  await section.getByLabel('Текущий пароль', { exact: true }).fill(randomBytes(18).toString('hex'));
  await section.getByLabel('Новый пароль', { exact: true }).fill(password);
  await section.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Пароль неверный');
  await section.getByLabel('Текущий пароль', { exact: true }).fill(family.person('child').password);
  await section.getByLabel('Новый пароль', { exact: true }).fill(password);
  await section.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Пароль изменён');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByLabel('Имя пользователя или почта').fill('child');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expectSignedIn(page);
});

test('выход везде завершает текущую сессию и сессию другого браузера', async ({
  page,
  family,
  browser,
}) => {
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await otherPage.goto(family.baseURL);
    await signIn(otherPage, family, 'adult');
    await expectSignedIn(otherPage);
    await signIn(page, family, 'adult');
    await expectSignedIn(page);
    await page.goto('#/more/settings');
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Выйти на всех устройствах' }).click();
    await page.getByRole('button', { name: 'Подтвердить выход везде' }).click();
    await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
    await otherPage.reload();
    await expect(otherPage.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('выдача новых резервных кодов с повторным вводом пароля', async ({ page, family }) => {
  const enrollment = await family.enroll('adult');
  await signIn(page, family, 'adult');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Получить новые резервные коды' }).click();
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Заменить резервные коды' }).click();
  await expect(page.locator('.backup-grid li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Я сохранил коды' }).click();
  await expect(page.locator('.backup-grid')).toHaveCount(0);
});

test('экспорт требует пароль, скачивается локально', async ({ page, family }) => {
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.goto('#/more/export');
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('child').password);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON' }).click();
  expect((await download).suggestedFilename()).toBe('homecrm-export.json');
  await expect(page.getByText('Файл с вашими данными скачан.', { exact: true })).toBeVisible();
});
