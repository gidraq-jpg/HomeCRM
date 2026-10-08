import type { Page, TestInfo } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { setScope } from '../support/helpers.ts';
import { apiAs, expectNothingStored, seedNote, seedObject } from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  // Снимок остаётся в test-results/screens: docs/screenshots/R0.6 — эталон задачи R0.6, его сценарий не перезаписывает.
  await checkApp(page, info, `search-${name}`);
}
test('пустое состояние, короткий запрос и ничего не найдено; строка только в памяти', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.getByRole('link', { name: 'Поиск', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Поиск по вашим записям' })).toBeVisible();
  await expect(page.getByLabel('Что найти')).toBeFocused();
  await check(page, info, 'empty');
  await page.getByLabel('Что найти').fill('сч');
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Введите хотя бы 3 символа',
  );
  await check(page, info, 'short');
  await page.getByLabel('Что найти').fill('невстречающеесяслово');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await check(page, info, 'none');
  await expectNothingStored(page, ['невстречающеесяслово']);
  await page.reload();
  await expect(page.getByLabel('Что найти')).toHaveValue('');
});
test('группы, фрагменты, копирование номера, фильтр и переход в карточку', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Счётчики: памятка',
    body: 'Проверить счётчика показания. Телефон +7 (900) 555-01-23',
    audience: 'household',
  });
  await seedNote(api, family, { title: 'Счётчик личный', body: 'Моя инструкция' });
  const object = await seedObject(api, family, {
    title: 'Счётчик воды',
    fields: [{ name: 'Номер', value: '7712345678' }],
    audience: 'household',
  });
  expect(
    (
      await api.post(`objects/${object.id}/events`, {
        text: 'Поверка счётчика выполнена',
        occurredOn: '2026-10-07',
      })
    ).status,
  ).toBe(201);
  await signInAs(page, family, 'adult');
  await page.goto('#/search');
  await page.getByLabel('Что найти').fill('счётчик');
  await expect(page.getByRole('heading', { level: 2, name: 'Заметки' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Объекты' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'События' })).toBeVisible();
  await expect(page.locator('mark').first()).toBeVisible();
  await check(page, info, 'groups');
  await page
    .getByRole('button', { name: 'Скопировать номер +7 (900) 555-01-23', exact: true })
    .click();
  await expect(page.locator('.toast-region')).toContainText('Скопировано');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('+7 (900) 555-01-23');
  await setScope(page, 'Личное');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('Счётчик личный');
  await check(page, info, 'personal');
  await setScope(page, 'Общее');
  await expect(page.locator('.search-result')).toHaveCount(3);
  await expectNothingStored(page, ['счётчик']);
  await page.getByRole('link').filter({ hasText: 'Счётчики: памятка' }).click();
  await expect(page).toHaveURL(new RegExp(`/more/notes/${note.id}$`));
});
test('ребёнок не видит ни личное взрослого, ни аудиторию Взрослые; короткий запрос очищает выдачу', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  await seedNote(api, family, { title: 'Термостат скрытый 889977' });
  await seedNote(api, family, { title: 'Термостат взрослые 889977', audience: 'adults' });
  await seedNote(api, family, { title: 'Термостат общий', audience: 'household' });
  await signInAs(page, family, 'child');
  await page.goto('#/search');
  await page.getByLabel('Что найти').fill('термостат');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('Термостат общий');
  await check(page, info, 'child');
  await page.getByLabel('Что найти').fill('889977');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await page.getByLabel('Что найти').fill('те');
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.route('**/api/search?*', (route) =>
    route.fulfill({ status: 503, body: '{}', contentType: 'application/json' }),
  );
  await page.getByLabel('Что найти').fill('ошибка');
  await expect(page.getByRole('alert')).toContainText('Не удалось выполнить поиск');
  await check(page, info, 'error');
});
