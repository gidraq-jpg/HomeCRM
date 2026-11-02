import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '../auth/support/fixtures.ts';
import { checkApp, expect, openSection, signInAs } from './support.ts';

test('D43: удержание, четыре карточки, проверка, правка и общее сохранение', async ({
  page,
  family,
}, info) => {
  await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    family.houseId,
  ]);
  await page.addInitScript(() => {
    class Recognition {
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: 'Учебная смешанная фраза' } }],
        });
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true });
  });
  const field = (value: string | null, confident = true) => ({ value, confident });
  await page.route('**/api/ai/extract', (route) =>
    route.fulfill({
      json: [
        {
          kind: 'task',
          title: field('Учебное дело'),
          date: field('2026-11-02'),
          time: field(null),
          assigneeId: field(null),
          objectId: field(null),
        },
        { kind: 'shopping', title: field('Учебные лампочки'), quantity: field('2 шт', false) },
        { kind: 'note', title: field('Учебная заметка'), body: field('Вымышленный текст') },
        { kind: 'note', title: field('Вторая заметка'), body: field('Ещё вымышленный текст') },
      ],
    }),
  );
  await signInAs(page, family, 'adult');
  await page.evaluate(
    ({ member, house }) => {
      localStorage.setItem(`homecrm:ai-consent:v4:fake:${member}:${house}`, 'yes');
    },
    { member: family.person('adult').id, house: family.houseId },
  );
  // Используем фактический идентификатор поставщика из статуса.
  await page.evaluate(
    async ({ member, house }) => {
      const response = await fetch(`/api/ai/status?spaceId=${house}`);
      const status = await response.json();
      localStorage.setItem(`homecrm:ai-consent:v4:${status.provider}:${member}:${house}`, 'yes');
      window.dispatchEvent(new Event('ai-consent'));
    },
    { member: family.person('adult').id, house: family.houseId },
  );
  await openSection(page, '/today', 'Сегодня');
  const add = page.getByRole('button', {
    name: 'Добавить. Удерживайте, чтобы сказать ИИ',
    exact: true,
  });
  await add.click();
  await expect(page.getByRole('dialog', { name: 'Добавить', exact: true })).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Добавить', exact: true }).getByRole('button').nth(1),
  ).toContainText('Сказать ИИ');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await add.dispatchEvent('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'touch',
  });
  await expect(page.getByRole('dialog', { name: 'Слушаю…' })).toBeVisible();
  await page.dispatchEvent('body', 'pointerup', { pointerId: 1 });
  const dialog = page.getByRole('dialog', { name: 'Черновики ИИ', exact: true });
  await expect(dialog.locator('.compact-draft')).toHaveCount(4);
  const save = dialog.getByRole('button', { name: 'Сохранить все (4)', exact: true });
  await expect(save).toBeDisabled();
  await checkApp(page, info, 'd43-compact');
  const dir = resolve('../../docs/screenshots/d43');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `compact-${info.project.name}.png`) });
  await dialog.getByRole('button', { name: 'Изменить', exact: true }).nth(1).click();
  const edit = page.getByRole('dialog', { name: 'Изменить черновик', exact: true });
  await edit.getByLabel('Количество — проверьте').fill('3 шт');
  await edit.getByRole('button', { name: 'Готово', exact: true }).click();
  await dialog.getByRole('button', { name: 'Изменить', exact: true }).first().click();
  await edit.getByLabel('Название', { exact: true }).fill('Исправленное учебное дело');
  await edit.getByRole('button', { name: 'Готово', exact: true }).click();
  await save.click();
  await expect(dialog.getByText('Черновиков не осталось')).toBeVisible();
  const counts = await family.database.admin.query(
    'SELECT (SELECT count(*)::int FROM tasks) AS tasks, (SELECT count(*)::int FROM shopping_items) AS shopping, (SELECT count(*)::int FROM notes) AS notes',
  );
  expect(counts.rows[0]).toEqual({ tasks: 1, shopping: 1, notes: 2 });
});

for (const denied of [false, true])
  test(`D43: ${denied ? 'запрет микрофона' : 'без распознавания'}, текст, офлайн и отмена`, async ({
    page,
    context,
    family,
  }, info) => {
    await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
      family.houseId,
    ]);
    await page.addInitScript((fail) => {
      for (const key of ['SpeechRecognition', 'webkitSpeechRecognition'])
        Object.defineProperty(window, key, {
          value: fail
            ? class {
                start() {
                  throw new DOMException('denied', 'NotAllowedError');
                }
                abort() {}
              }
            : undefined,
          configurable: true,
        });
    }, denied);
    await signInAs(page, family, 'adult');
    const add = page.getByRole('button', { name: 'Добавить', exact: true });
    await add.click();
    await expect(page.getByRole('button', { name: /^Сказать ИИ/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.evaluate(
      async ({ member, house }) => {
        const status = await (await fetch(`/api/ai/status?spaceId=${house}`)).json();
        localStorage.setItem(`homecrm:ai-consent:v4:${status.provider}:${member}:${house}`, 'yes');
        window.dispatchEvent(new Event('ai-consent'));
      },
      { member: family.person('adult').id, house: family.houseId },
    );
    const trigger = page.getByRole('button', {
      name: 'Добавить. Удерживайте, чтобы сказать ИИ',
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Сказать ИИ/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Сказать ИИ', exact: true });
    await expect(dialog).toContainText(
      denied ? 'Нет доступа к микрофону' : 'не поддерживает распознавание',
    );
    const text = dialog.getByLabel('Текст для разбора');
    await text.fill('Вымышленная фраза без сети');
    await context.setOffline(true);
    await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(dialog).toContainText('Нет сети. Текст сохранён');
    await expect(text).toHaveValue('Вымышленная фраза без сети');
    await context.setOffline(false);
    await page.route('**/api/ai/extract', (route) =>
      route.fulfill({ status: 503, json: { code: 'AI_UNAVAILABLE' } }),
    );
    await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(dialog).toContainText('Текст сохранён на этом экране');
    await expect(text).toHaveValue('Вымышленная фраза без сети');
    await checkApp(page, info, `d43-fallback-${denied}`);
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await family.database.admin.query('SELECT id FROM tasks')).rowCount).toBe(0);
  });
