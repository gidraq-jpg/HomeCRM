import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn } from './support/helpers.ts';

test('отзыв текущей сессии возвращает на вход', async ({ page, family }) => {
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Завершить сессию' }).click();
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
});

test('взрослый выключает TOTP с повторным вводом пароля', async ({ page, family }) => {
  const enrollment = await family.enroll('adult');
  await signIn(page, family, 'adult');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).click();
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).last().click();
  await expect(page.getByText('Второй фактор пока не включён.', { exact: false })).toBeVisible();
});

test('администратор приглашает ребёнка: из настроек — к экрану «Люди»', async ({
  page,
  family,
}, info) => {
  const enrollment = await family.enroll('admin');
  await signIn(page, family, 'admin');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await expect(page.getByRole('button', { name: 'Выключить второй фактор' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Пригласить участника' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Пригласить участника' })).toBeVisible();
  await page.getByRole('radio', { name: /Ребёнок/ }).check();
  await page.getByRole('button', { name: 'Создать ссылку-приглашение' }).click();
  await expect(page.getByTestId('issued-link')).toContainText('/invite/');
  await checkAuth(page, info, 'invite-admin');
  const { rows } = await family.database.admin.query('SELECT role FROM invitations');
  expect(rows.map((row: { role: string }) => row.role)).toEqual(['child']);
});

test('устройства без токенов: текущее отмечено, другое отзывается по id', async ({
  page,
  family,
  browser,
}, info) => {
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await otherPage.goto(family.baseURL);
    await signIn(otherPage, family, 'child');
    await expectSignedIn(otherPage);
    await signIn(page, family, 'child');
    await expectSignedIn(page);
    const response = page.waitForResponse('**/api/auth/list-sessions');
    await page.goto('#/more/settings');
    const list = (await (await response).json()) as Array<{ id: string; current: boolean }>;
    expect(list).toHaveLength(2);
    for (const session of list) {
      expect(Object.keys(session).sort()).toEqual(
        ['id', 'userAgent', 'ipAddress', 'createdAt', 'updatedAt', 'expiresAt', 'current'].sort(),
      );
    }
    await expect(page.getByText('Это устройство', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(2);
    await checkAuth(page, info, 'session-devices');
    const otherRow = page.locator('.security-list li').filter({
      has: page.getByRole('button', { name: 'Завершить сессию' }),
      hasNotText: 'Это устройство',
    });
    const revoke = page.waitForRequest('**/api/auth/revoke-session');
    await otherRow.getByRole('button', { name: 'Завершить сессию' }).click();
    expect((await revoke).postDataJSON()).toEqual({
      id: list.find((session) => !session.current)?.id,
    });
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(1);
    await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
    await otherPage.reload();
    await expect(otherPage.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  } finally {
    await other.close();
  }
});
