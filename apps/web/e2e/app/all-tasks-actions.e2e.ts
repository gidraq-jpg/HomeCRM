import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

async function capture(page: Page, name: string) {
  if (process.platform !== 'linux') return;
  const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/D17');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}

test('TASK-6/12: все дела — выполнение, возврат, перенос и история', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const base = { placement: { spaceId: family.houseId, audience: 'household' } };
  for (const fields of [
    { title: 'Покрасить стены', planOn: homeDate(-1), dueOn: homeDate(-1) },
    { title: 'Проверить фильтр', planOn: homeDate(0), planTime: '18:00' },
    { title: 'Прочитать инструкцию' },
  ])
    expect((await api.post('tasks', { ...base, ...fields })).status).toBe(201);
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: 'Покрасить стены', exact: true })).toBeVisible();
  const width = info.project.use.viewport?.width;
  if (process.env.D17_BEFORE) {
    await page
      .getByRole('button', { name: 'Отметить сделанным: Покрасить стены', exact: true })
      .click();
    await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
    await capture(page, `before-${width}`);
    return;
  }
  await page
    .getByRole('button', { name: 'Отметить сделанным: Покрасить стены', exact: true })
    .click();
  await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
  const completed = page.locator('.plan-row').filter({ hasText: 'Покрасить стены' });
  await expect(completed).toHaveClass(/plan-row--closed/);
  await expect(
    completed.getByRole('link', { name: 'Покрасить стены · выполнено', exact: true }),
  ).toBeVisible();
  await expect(completed.locator('.plan-circle--done')).toBeVisible();
  await expect(completed.getByText('Просрочено', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Просрочено', exact: true }).locator('.plan-row'),
  ).toHaveCount(1);
  await expect(page.getByRole('link', { name: '2 открытых дела', exact: true })).toBeVisible();
  await capture(page, `after-${width}`);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Выполнение отменено', { exact: true })).toBeVisible();
  await expect(completed).not.toHaveClass(/plan-row--closed/);
  await page
    .getByRole('button', { name: 'Отметить сделанным: Покрасить стены', exact: true })
    .click();
  await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
  await expectAccessible(page, `all-tasks-completed-${width}`);
  await page.getByRole('button', { name: 'Возобновить: Покрасить стены', exact: true }).click();
  await expect(page.getByText('Дело возобновлено', { exact: true })).toBeVisible();
  await expect(completed).not.toHaveClass(/plan-row--closed/);
  await page.getByRole('button', { name: 'Перенести: Проверить фильтр', exact: true }).click();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Перенос отменён', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Назначить день: Прочитать инструкцию', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Без даты', exact: true })).toHaveCount(0);
  await expectAccessible(page, `all-tasks-move-${width}`);
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Без даты', exact: true })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, `all-tasks-${width}`);
});

test('TASK-6: старые завершённые дела — через статус; чужое дело ребёнку доступно только для чтения', async ({
  page,
  family,
}, info) => {
  test.skip(!!process.env.D17_BEFORE, 'Исходные снимки снимает первый сценарий');
  await setHomeZone(family, 'Pacific/Kiritimati');
  const api = await apiAs(family, 'adult');
  const base = { placement: { spaceId: family.houseId, audience: 'household' } };
  const zone = 'Pacific/Kiritimati';
  const day = homeDate(0, zone);
  const before = homeDate(-1, zone);
  const ids: string[] = [];
  for (const fields of [
    { title: 'Старое выполненное', status: 'done', planOn: before },
    { title: 'Старое отменённое', status: 'cancelled', planOn: before },
  ]) {
    const created = await api.post('tasks', { ...base, ...fields });
    expect(created.status).toBe(201);
    ids.push((created.body as { id: string }).id);
  }
  // Только одноразовая тестовая база: переносим updatedAt на секунду до полуночи дома.
  await family.database.admin.query('ALTER TABLE tasks DISABLE TRIGGER USER');
  try {
    await family.database.admin.query(
      "UPDATE tasks SET updated_at=($1::date::timestamp AT TIME ZONE $2)-interval '1 second' WHERE id=ANY($3::uuid[])",
      [day, zone, ids],
    );
  } finally {
    await family.database.admin.query('ALTER TABLE tasks ENABLE TRIGGER USER');
  }
  const active = await api.post('tasks', { ...base, title: 'Чужое открытое дело', planOn: day });
  expect(active.status).toBe(201);
  const current = await api.post('tasks', {
    ...base,
    title: 'Выполнено в этот день',
    status: 'done',
    planOn: day,
  });
  expect(current.status).toBe(201);
  await signInAs(page, family, 'child');
  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: 'Чужое открытое дело', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Выполнено в этот день · выполнено', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Старое (выполненное|отменённое)/ })).toHaveCount(0);
  await expect(page.locator('.plan-rows button')).toHaveCount(0);
  await expect(page.locator('.plan-circle--done')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '1 открытое дело', exact: true })).toBeVisible();
  const child = await apiAs(family, 'child');
  const card = active.body as { id: string; updatedAt: string };
  expect(
    (
      await child.post(`tasks/${card.id}/status`, {
        status: 'done',
        expectedUpdatedAt: card.updatedAt,
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await child.patch(`tasks/${card.id}`, {
        planOn: before,
        expectedUpdatedAt: card.updatedAt,
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(403);
  const done = current.body as { id: string; updatedAt: string };
  expect(
    (
      await child.post(`tasks/${done.id}/status`, {
        status: 'open',
        expectedUpdatedAt: done.updatedAt,
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(403);
  await page.locator('.studio-list-options summary').click();
  await page.getByLabel('Статус дел', { exact: true }).selectOption('done');
  await expect(
    page.getByRole('link', { name: 'Старое выполненное · выполнено', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.plan-row--closed')).toHaveCount(2);
  await expect(page.locator('.plan-row--closed .studio-label--overdue')).toHaveCount(0);
  await page.getByLabel('Статус дел', { exact: true }).selectOption('cancelled');
  await expect(
    page.getByRole('link', { name: 'Старое отменённое · отменено', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.plan-row--closed')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, `all-tasks-history-child-${info.project.use.viewport?.width}`);
  await capture(page, `history-child-${info.project.use.viewport?.width}`);
});

test('TASK-6/12: Жду и повтор — перенос и отмена через общую очередь офлайн', async ({
  page,
  context,
  family,
}) => {
  test.skip(!!process.env.D17_BEFORE, 'Исходные снимки снимает первый сценарий');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const base = { placement: { spaceId: family.houseId, audience: 'household' } };
  const waiting = await api.post('tasks', {
    ...base,
    title: 'Дождаться справки',
    status: 'waiting',
    planOn: homeDate(0),
    checkOn: homeDate(1),
    waitingAccountId: family.person('admin').id,
  });
  expect(waiting.status).toBe(201);
  const series = await api.post('tasks', {
    ...base,
    title: 'Повторяющееся дело',
    planOn: homeDate(2),
    planTime: '09:00',
    repeatRule: { kind: 'daily' },
  });
  expect(series.status).toBe(201);
  const id = (series.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await page.getByRole('button', { name: 'Перенести: Дождаться справки', exact: true }).click();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Перенос отменён', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Отметить сделанным: Дождаться справки', exact: true })
    .click();
  await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Выполнение отменено', { exact: true })).toBeVisible();
  await expect(page.locator('.plan-circle--waiting')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Перенести: Повторяющееся дело', exact: true }).click();
  await expect(page.getByRole('button', { name: /Этот и следующие/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Только этот раз', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Без даты', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве. Отправим при появлении сети.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Перенос отменён', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => (await api.get(`tasks/${id}`)).body)
    .toMatchObject({ planOn: homeDate(2), planTime: '09:00' });
  // Ждём именно подтверждения обеих операций: исходная дата совпадает и до отправки очереди.
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise<boolean>((done, reject) => {
            const request = indexedDB.open('homecrm-offline');
            request.onerror = () => reject(new Error('Test database unavailable'));
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('outbox', 'readonly');
              const rows = tx.objectStore('outbox').getAll();
              rows.onsuccess = () =>
                done(
                  rows.result.length >= 2 &&
                    rows.result.every((row: { state: string }) => row.state === 'confirmed'),
                );
              tx.oncomplete = () => db.close();
            };
          }),
      ),
    )
    .toBe(true);
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    planOn: homeDate(2),
    planTime: '09:00',
  });
});
