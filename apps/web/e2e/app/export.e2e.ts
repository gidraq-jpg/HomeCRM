import { test } from '../auth/support/fixtures.ts';
import { checkApp, expect, signInAs } from './support.ts';

test('DATA-2: ребёнок — личный ZIP, подтверждение, ошибка и повтор', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'child');
  await page.goto('#/more');
  await page.getByRole('link', { name: /Мои данные/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои данные' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать общее дома' })).toHaveCount(0);
  await checkApp(page, info, 'export-child');
  await page.getByLabel('Подтвердите пароль', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Скачать моё личное' }).click();
  // Неподтверждённая форма не отправляет архив.
  await expect(page.getByLabel('Скачать архив с открытыми данными и файлами')).not.toBeChecked();
  await page.getByLabel('Скачать архив с открытыми данными и файлами').check();
  await page.getByRole('button', { name: 'Скачать моё личное' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Подтвердите пароль', { exact: true })).toHaveValue('');
  await checkApp(page, info, 'export-error');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/export/archive', async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('child').password);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать моё личное' }).click();
  await expect(page.getByText('Собираем и скачиваем архив… Дождитесь завершения.')).toBeVisible();
  await checkApp(page, info, 'export-pending');
  release();
  expect((await download).suggestedFilename()).toBe('homecrm-personal.zip');
  await expect(page.getByText('Архив передан браузеру для скачивания.')).toBeVisible();
});

test('DATA-2: администратор — отдельные личный и общий архивы', async ({ page, family }, info) => {
  await signInAs(page, family, 'admin');
  await page.goto('#/more/export');
  await expect(page.getByRole('button', { name: 'Скачать моё личное' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать общее дома' })).toBeVisible();
  await checkApp(page, info, 'export-admin');
  const form = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Общее дома', exact: true }) });
  await form
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('admin').password);
  await form.getByLabel('Скачать архив с открытыми данными и файлами').check();
  const download = page.waitForEvent('download');
  await form.getByRole('button', { name: 'Скачать общее дома' }).click();
  expect((await download).suggestedFilename()).toBe('homecrm-household.zip');
});
