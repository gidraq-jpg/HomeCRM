import { test } from '../auth/support/fixtures.ts';
import { openQuick } from '../support/helpers.ts';
import { checkApp, expect, openSection, signInAs } from './support.ts';

async function enable(family: import('../auth/support/family.ts').Family) {
  await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    family.houseId,
  ]);
}
test('AI-2: фраза → смешанные черновики → правка → сохранение; согласие один раз', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/today', 'Сегодня');
  await openQuick(page);
  const input = page.getByLabel('Быстрая строка', { exact: true });
  const text = 'завтра позвонить сантехнику и купить лампочки и заметка: ключ у соседки';
  await input.fill(text);
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/ai/extract')) requests++;
  });
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toBeVisible();
  expect(requests).toBe(0);
  await checkApp(page, info, 'ai-consent');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(input).toHaveValue(text);
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  const dialog = page.getByRole('dialog', { name: 'Черновики ИИ' });
  await expect(dialog).toBeVisible();
  expect(requests).toBe(1);
  const task = dialog.getByRole('region', { name: 'Дело 1' });
  await expect(task.getByLabel('Дата', { exact: true })).not.toHaveValue('');
  await task.getByLabel('Название', { exact: true }).fill('Проверить смеситель');
  await expect(dialog.getByText('Количество — проверьте', { exact: true })).toBeVisible();
  await checkApp(page, info, 'ai-drafts');
  // Сбой второй карточки не возвращает уже сохранённое дело и оставляет остальные черновики.
  await page.route('**/api/shopping', (route) =>
    route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }),
  );
  await dialog.getByRole('button', { name: 'Сохранить все', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Дело 1' })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Покупка 1' })).toBeVisible();
  await page.unroute('**/api/shopping');
  await dialog.getByRole('button', { name: 'Сохранить все', exact: true }).click();
  await expect(dialog.getByText('Черновиков не осталось')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть черновики' }).click();
  await expect(input).toHaveValue(text);
  const counts = await family.database.admin.query(
    `SELECT (SELECT count(*)::int FROM tasks WHERE title='Проверить смеситель') AS tasks, (SELECT count(*)::int FROM shopping_items WHERE title='лампочки') AS shopping, (SELECT count(*)::int FROM notes WHERE body='ключ у соседки') AS notes`,
  );
  expect(counts.rows[0]).toEqual({ tasks: 1, shopping: 1, notes: 1 });
  await page.reload();
  await openQuick(page);
  await input.fill('купить хлеб');
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(dialog.getByText('Черновиков не осталось')).toBeVisible();
});

test('AI-6/7: покупки — сохранение одной карточки, сбои не стирают фразу', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/shopping', 'Покупки');
  const input = page.getByLabel('Добавить одной строкой', { exact: true });
  await input.fill('купить лампочки');
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  const dialog = page.getByRole('dialog', { name: 'Черновики ИИ' });
  await dialog.getByLabel('Количество — проверьте').fill('3 шт');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByText('Черновиков не осталось')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть черновики' }).click();
  await expect(page.getByText('3 шт', { exact: true })).toBeVisible();
  for (const code of [
    'AI_DAILY_LIMIT',
    'AI_UNAVAILABLE',
    'AI_DISABLED',
    'AI_BUSY',
    'AI_INVALID_RESPONSE',
  ]) {
    await page.route('**/api/ai/extract', (route) =>
      route.fulfill({ status: code === 'AI_DAILY_LIMIT' ? 429 : 503, json: { code } }),
    );
    await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Введённый текст сохранён');
    await expect(input).toHaveValue('купить лампочки');
    await page.unroute('**/api/ai/extract');
  }
  await checkApp(page, info, 'ai-shopping-error');
});

test('AI-3: выключенный ИИ скрывает кнопки разбора', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  for (const [path, heading] of [
    ['/today', 'Сегодня'],
    ['/more/shopping', 'Покупки'],
  ]) {
    await openSection(page, path ?? '', heading ?? '');
    await expect(page.getByRole('button', { name: 'Разобрать', exact: true })).toHaveCount(0);
  }
});
