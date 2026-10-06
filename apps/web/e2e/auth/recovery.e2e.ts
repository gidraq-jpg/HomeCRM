import { randomBytes } from 'node:crypto';
import { currentCode } from '../../../server/src/testing/totp.ts';
import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, type signIn } from './support/helpers.ts';

async function adminCookie(family: Parameters<typeof signIn>[1]) {
  const enrollment = await family.enroll('admin');
  const signed = await family.post('auth/sign-in/username', {
    username: 'admin',
    password: family.person('admin').password,
  });
  const pending = signed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const verified = await family.post(
    'auth/two-factor/verify-totp',
    { code: currentCode(enrollment.totpURI) },
    pending,
  );
  if (verified.status !== 200) throw new Error('Test admin sign-in failed');
  return verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

test('приглашение без почты; роль приходит от сервера; ссылка удаляется из адреса', async ({
  page,
  family,
}, info) => {
  const cookie = await adminCookie(family);
  const invited = await family.post(
    'invitations',
    { householdId: family.houseId, role: 'child' },
    cookie,
  );
  const link = (await invited.json()) as { url: string; token: string };
  await page.goto(link.url);
  await expect(page.getByRole('heading', { name: 'Приглашение в дом' })).toBeVisible();
  await expect(page).toHaveURL(/#\/invite$/);
  expect(page.url().includes(link.token)).toBe(false);
  await checkAuth(page, info, 'invite');
  await page.getByLabel('Как вас зовут').fill('Ира');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('ira');
  const password = randomBytes(18).toString('hex');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(page.getByRole('heading', { name: 'Защитить вход' })).toBeVisible();
  const me = (await page.evaluate(async () =>
    (await fetch('/api/me', { cache: 'no-store' })).json(),
  )) as {
    roles: { role: string }[];
    email: string | null;
  };
  expect(me.roles.map(({ role }) => role)).toEqual(['child']);
  expect(me.email).toBeNull();
});

test('недействительное приглашение показывает понятную ошибку', async ({ page, family }, info) => {
  await page.goto(`${family.origin}/invite/${randomBytes(32).toString('base64url')}`);
  await page.getByLabel('Как вас зовут').fill('Ира');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('ira');
  await page.getByLabel('Пароль', { exact: true }).fill(randomBytes(18).toString('hex'));
  await page.getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(page.getByRole('alert')).toContainText('Приглашение недействительно');
  await checkAuth(page, info, 'invite-error');
});

test('сброс ребёнку по прямой ссылке и отметка при следующем входе', async ({
  page,
  family,
}, info) => {
  const cookie = await adminCookie(family);
  const reset = await family.post(
    'auth/homecrm/child-reset-link',
    { accountId: family.person('child').id },
    cookie,
  );
  const link = (await reset.json()) as { url: string; token: string };
  await page.goto(link.url);
  await expect(page.getByRole('heading', { name: 'Новый пароль', exact: true })).toBeVisible();
  expect(page.url().includes(link.token)).toBe(false);
  await checkAuth(page, info, 'reset');
  const password = randomBytes(18).toString('base64url');
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите новый пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByRole('heading', { name: 'Пароль изменён' })).toBeVisible();
  await page.getByRole('link', { name: 'К входу' }).click();
  await page.getByLabel('Имя пользователя или почта').fill('child');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expectSignedIn(page);
  await expect(page.getByText('Ваш пароль сбросил администратор.')).toBeVisible();
  // Первые 7 дней отметку не закрыть никому: кнопки нет, сказано, до какого дня она видна (AUTH-5).
  await expect(page.getByText(/Эта плашка будет видна до \d{1,2} [а-я]+\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Я прочитал' })).toHaveCount(0);
  const early = await page.evaluate(async () => {
    const response = await fetch('/api/me/password-reset/ack', { method: 'POST' });
    return { status: response.status, body: (await response.json()) as { code: string } };
  });
  expect(early).toEqual({
    status: 409,
    body: { code: 'RESET_NOTICE_LOCKED', message: expect.any(String) },
  });
  await checkAuth(page, info, 'reset-notice');
  // Через 7 дней: появляется кнопка «Я прочитал», и отметка закрывается.
  await family.database.admin.query(
    `UPDATE password_resets SET completed_at = now() - interval '7 days 1 minute' WHERE account_id = $1`,
    [family.person('child').id],
  );
  await page.reload();
  await expectSignedIn(page);
  await expect(page.getByText(/Эта плашка будет видна до/)).toHaveCount(0);
  await checkAuth(page, info, 'reset-notice-unlocked');
  await page.getByRole('button', { name: 'Я прочитал' }).click();
  await expect(page.getByText('Ваш пароль сбросил администратор.')).toHaveCount(0);
  await page.reload();
  await expectSignedIn(page);
  await expect(page.getByText('Ваш пароль сбросил администратор.')).toHaveCount(0);
});

test('сброс без токена и несовпадающие пароли', async ({ page, family }, info) => {
  await page.goto('#/reset-password');
  await expect(page.getByRole('alert')).toContainText('Ссылка недействительна');
  await checkAuth(page, info, 'reset-error');
  await page.goto(`${family.origin}/reset-password?token=${randomBytes(32).toString('base64url')}`);
  await page.getByLabel('Новый пароль', { exact: true }).fill(randomBytes(18).toString('hex'));
  await page
    .getByLabel('Повторите новый пароль', { exact: true })
    .fill(randomBytes(18).toString('hex'));
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByRole('alert')).toContainText('Пароли отличаются');
});

test('почта не настроена: экран восстановления сообщает об этом', async ({ page }, info) => {
  await page.goto('#/forgot-password');
  await checkAuth(page, info, 'forgot');
  await page.getByLabel('Почта', { exact: true }).fill('adult@family.test');
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Восстановление по почте на сервере не настроено',
  );
});
