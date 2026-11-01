import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test('SHOP-3: пять строк, количество, дубли и отмена всей пачки', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  const input = page.getByLabel('Добавить одной строкой', { exact: true });
  await input.fill('хлеб 2\n2 л молока\nяйца 10\n3 батона\nсыр');
  await expect(input).toHaveAttribute('rows', '5');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.locator('li.task-row')).toHaveCount(5);
  await expect(page.getByText('Добавлено 5 покупок', { exact: true })).toBeVisible();
  await expectAccessible(page, 'd42-added');
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const dir = resolve(import.meta.dirname, '../../test-results/d42');
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${info.project.name}-added.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('li.task-row')).toHaveCount(0);
  await input.fill('молоко 2 л; молоко 2 л; яйца 10');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.locator('li.task-row')).toHaveCount(2);
  await expect(
    page.getByText('Добавлены 2 покупки. Пропущено дублей: 1', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Увеличить количество: Молоко' }).click();
  const row = page
    .locator('li.task-row')
    .filter({ has: page.getByRole('link', { name: 'Молоко', exact: true }) });
  await expect(row.locator('.shopping-quantity')).toHaveText('3 л');
  await page.getByRole('button', { name: 'Уменьшить количество: Молоко' }).click();
  await expect(row.locator('.shopping-quantity')).toHaveText('2 л');
  const api = await apiAs(family, 'adult');
  const saved = await api.get(
    `shopping?scope=household&spaceId=${family.houseId}&trash=false&bought=all`,
  );
  expect((saved.body as unknown[]).length).toBe(2);
});

test('SHOP-3, AI-2: ИИ открывает редактируемый список и ждёт подтверждения', async ({
  page,
  family,
}, info) => {
  await page.route('**/api/ai/status?**', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        provider: 'openai:test',
        speech: true,
        extraction: true,
        remaining: 100,
      },
    }),
  );
  await page.route('**/api/ai/extract', (route) => {
    expect(route.request().postDataJSON().kind).toBe('shopping');
    return route.fulfill({
      json: ['Молоко', 'Хлеб'].map((title) => ({
        title: { value: title, confident: true },
        quantity: { value: null, confident: true },
      })),
    });
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  await page.getByLabel('Добавить одной строкой', { exact: true }).fill('молоко и хлеб');
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  const sheet = page.getByRole('dialog', { name: 'Надиктованные покупки' });
  await expect(sheet.getByRole('listitem')).toHaveCount(2);
  const api = await apiAs(family, 'adult');
  expect(
    (await api.get(`shopping?scope=household&spaceId=${family.houseId}&trash=false&bought=all`))
      .body,
  ).toEqual([]);
  await expectAccessible(page, 'd42-ai-confirm');
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const dir = resolve(import.meta.dirname, '../../test-results/d42');
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: resolve(dir, `${info.project.name}-ai-confirm.png`),
      fullPage: true,
    });
  }
  await sheet.getByLabel('Количество позиции 1', { exact: true }).fill('2 л');
  await sheet.getByRole('button', { name: 'Убрать позицию: Хлеб' }).click();
  await sheet.getByRole('button', { name: 'Добавить 1 позицию' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Молоко', exact: true })).toBeVisible();
});
