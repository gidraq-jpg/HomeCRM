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

test('администратор приглашает ребёнка из настроек', async ({ page, family }, info) => {
  const enrollment = await family.enroll('admin');
  await signIn(page, family, 'admin');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await expect(page.getByRole('button', { name: 'Выключить второй фактор' })).toHaveCount(0);
  await page.getByLabel('Роль участника').selectOption('child');
  await page.getByRole('button', { name: 'Создать приглашение' }).click();
  await expect(page.getByLabel('Ссылка-приглашение')).toBeVisible();
  await checkAuth(page, info, 'invite-admin');
  const { rows } = await family.database.admin.query('SELECT role FROM invitations');
  expect(rows.map((row: { role: string }) => row.role)).toEqual(['child']);
});
