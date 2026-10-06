import { randomBytes } from 'node:crypto';
import { currentCode } from '../../../server/src/testing/totp.ts';
import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn } from './support/helpers.ts';

test('вход ребёнка по имени без почты, перезагрузка и выход', async ({ page, family }, info) => {
  await page.goto('#/sign-in');
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  await checkAuth(page, info, 'login');
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.reload();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await expect(page.getByText('child · Без почты')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(storage.includes(family.person('child').password)).toBe(false);
});

test('вход взрослого по почте', async ({ page, family }) => {
  await signIn(page, family, 'adult', true);
  await expectSignedIn(page);
});

test('неверный пароль и блокировка не скрываются за загрузкой', async ({ page, family }, info) => {
  await page.goto('#/sign-in');
  for (let index = 0; index < 6; index++) {
    await page.getByLabel('Имя пользователя или почта').fill('child');
    await page
      .getByLabel('Пароль', { exact: true })
      .fill(index === 5 ? family.person('child').password : randomBytes(18).toString('hex'));
    const response = page.waitForResponse((reply) =>
      reply.url().endsWith('/api/auth/sign-in/username'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).status()).toBe(index === 5 ? 429 : 401);
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  }
  await expect(page.getByRole('alert')).toContainText('Вход временно заблокирован');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('');
  await checkAuth(page, info, 'locked');
});

test('TOTP и доверие устройству взрослого', async ({ page, family }, info) => {
  const enrollment = await family.enroll('adult');
  await signIn(page, family, 'adult');
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Доверять/ })).toBeVisible();
  await checkAuth(page, info, 'totp');
  await page.getByLabel('Код из приложения').fill(currentCode(enrollment.totpURI));
  await page.getByRole('checkbox', { name: /Доверять/ }).check();
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await signIn(page, family, 'adult');
  await expectSignedIn(page);
});

test('администратору доверие не предлагается, резервный код одноразовый', async ({
  page,
  family,
}, info) => {
  const enrollment = await family.enroll('admin');
  await signIn(page, family, 'admin');
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Доверять/ })).toHaveCount(0);
  await checkAuth(page, info, 'admin-totp');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await checkAuth(page, info, 'backup');
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await signIn(page, family, 'admin');
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expect(page.getByRole('alert')).toContainText('Код неверный или уже использован');
});

test('администратор без TOTP настраивает его и сохраняет 10 кодов', async ({
  page,
  family,
}, info) => {
  await signIn(page, family, 'admin');
  await expect(page.getByRole('heading', { name: 'Защитить вход' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('admin').password);
  await page.getByRole('button', { name: 'Настроить второй фактор' }).click();
  await expect(page.locator('.backup-grid li')).toHaveCount(10);
  await expect(page.getByRole('img', { name: 'QR-код настройки второго фактора' })).toBeVisible();
  await checkAuth(page, info, 'setup');
  const uri = await page
    .getByRole('link', { name: 'Открыть приложение на этом телефоне' })
    .getAttribute('href');
  await page.getByLabel('Код из приложения').fill(currentCode(uri ?? ''));
  await page.getByRole('button', { name: 'Включить второй фактор' }).click();
  await expect(page.getByRole('heading', { name: 'Второй фактор включён' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Я сохранил коды' }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expectSignedIn(page);
});

test('перезагрузка незавершённого TOTP возвращает к вводу пароля', async ({ page, family }) => {
  await family.enroll('adult');
  await signIn(page, family, 'adult');
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Сначала введите имя и пароль.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'К входу' }).click();
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
});
