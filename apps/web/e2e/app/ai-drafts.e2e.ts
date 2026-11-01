import type { Page } from '@playwright/test';
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
  let loseNoteResponse = true;
  await page.route('**/api/notes', async (route) => {
    if (route.request().method() !== 'POST' || !loseNoteResponse) return route.continue();
    loseNoteResponse = false;
    await route.fetch();
    await route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await dialog.getByRole('button', { name: 'Сохранить все', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Заметка 1' })).toBeVisible();
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
  const dialog = page.getByRole('dialog', { name: 'Надиктованные покупки' });
  await dialog.getByLabel('Количество позиции 1', { exact: true }).fill('3 шт');
  await dialog.getByRole('button', { name: 'Добавить 1 позицию', exact: true }).click();
  await expect(dialog).toHaveCount(0);
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

async function mockSpeech(page: Page, phrase: string) {
  await page.addInitScript((text) => {
    class Recognition {
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: text } }],
          });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value: Recognition, configurable: true });
  }, phrase);
}

test('AI-2, SHOP-4: надиктованная фраза покупок идёт в ИИ только после согласия', async ({
  page,
  family,
}, info) => {
  const phrase = 'завтра проверить насос и купить лампочки';
  await mockSpeech(page, phrase);
  await enable(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/shopping', 'Покупки');
  await expect(page.getByRole('button', { name: 'Разобрать', exact: true })).toBeVisible();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/ai/extract')) requests++;
  });
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await expect(page.getByLabel('Добавить одной строкой', { exact: true })).toHaveValue(phrase);
  await expect(page.getByRole('dialog', { name: 'Надиктованные покупки' })).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  const dialog = page.getByRole('dialog', { name: 'Надиктованные покупки' });
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  expect(requests).toBe(1);
  await checkApp(page, info, 'ai-voice-shopping');
});

test('SHOP-4, AI-6: надиктованная строка без «Разобрать» делится на позиции без ИИ', async ({
  page,
  family,
}) => {
  await page.route(
    '**/api/ai/status?**',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    },
    { times: 1 },
  );
  await mockSpeech(page, 'молоко, хлеб и яйца');
  await enable(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/shopping', 'Покупки');
  await expect(page.getByRole('button', { name: 'Разобрать', exact: true })).toBeVisible();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/ai/extract')) requests++;
  });
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await expect(page.getByLabel('Добавить одной строкой', { exact: true })).toHaveValue(
    'молоко, хлеб и яйца',
  );
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Надиктованные покупки' })).toBeVisible();
  expect(requests).toBe(0);
});

test('AI-2, SHOP-4: дубли в одной фразе и в существующем списке не добавляются', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/shopping', 'Покупки');
  const input = page.getByLabel('Добавить одной строкой', { exact: true });
  await input.fill('хлеб, хлеб');
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  const dialog = page.getByRole('dialog', { name: 'Надиктованные покупки' });
  await dialog.getByRole('button', { name: 'Добавить 2 позиции', exact: true }).click();
  await expect(dialog.getByText('Уже в списке', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await input.fill('хлеб');
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await dialog.getByRole('button', { name: 'Добавить 1 позицию', exact: true }).click();
  await expect(dialog.getByText('Уже в списке', { exact: true })).toBeVisible();
  const result = await family.database.admin.query(
    "SELECT count(*)::int AS count FROM shopping_items WHERE title='хлеб'",
  );
  expect(result.rows[0]?.count).toBe(1);
  await checkApp(page, info, 'ai-shopping-duplicate');
});
