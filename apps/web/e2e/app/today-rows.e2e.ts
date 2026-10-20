import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, openRadar, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await expectAccessible(page, `D20b-${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/D20b');
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: resolve(
        directory,
        `${process.env.D20B_PHASE ?? 'after'}-${name}-${info.project.name}.png`,
      ),
      fullPage: true,
    });
  }
}

test('D20b 1–4: кружки, компактные строки, выполненное и добавление', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const main = await api.post('tasks', {
    title: 'Проверить вымышленный фильтр',
    planOn: homeDate(0),
  });
  const id = (main.body as { id: string }).id;
  expect((await api.post(`tasks/${id}/main`, { selected: true })).status).toBe(200);
  expect(
    (await api.post('tasks', { title: 'Полить вымышленные цветы', planOn: homeDate(0) })).status,
  ).toBe(201);
  const note = await seedNote(api, family, { title: 'Вымышленная страховка' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  const urgent = page.getByRole('list', { name: 'Срочные сроки' });
  await expect(urgent.getByText('Вымышленная страховка', { exact: true })).toBeVisible();
  await check(page, info, 'today');
  await openRadar(page);
  await check(page, info, 'radar');
  if (process.env.D20B_PHASE === 'before') return;
  await page.goto('#/today');
  await expect(urgent.getByText('Вымышленная страховка', { exact: true })).toBeVisible();
  await expect(page.getByText('Выполнено сегодня (0)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Новое дело', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Как устроены личное и общее', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
  for (const list of ['Главное дело', 'Дела на сегодня']) {
    const done = page
      .getByRole('list', { name: list, exact: true })
      .getByRole('button', { name: 'Выполнить', exact: true });
    await expect(done.locator('.plan-circle')).toBeVisible();
    await expect(done.locator('svg')).toHaveCSS('opacity', '0');
    expect(
      await done.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(44);
  }
  const row = urgent.getByRole('listitem');
  await expect(row.getByRole('link')).toHaveCount(1);
  await expect(row.getByRole('button')).toHaveCount(1);
  await expect(row).not.toContainText('Ответственный — в карточке источника');
  const radarHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
  const taskHeight = await page
    .locator('.task-feed-item')
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(radarHeight).toBeLessThanOrEqual(taskHeight * 2);
  await page
    .getByRole('list', { name: 'Дела на сегодня', exact: true })
    .getByRole('button', { name: 'Выполнить', exact: true })
    .click();
  const completed = page.getByText('Выполнено сегодня (1)', { exact: true });
  await expect(completed).toBeVisible();
  await completed.click();
  await expect(
    page.getByRole('list', { name: 'Выполненные дела' }).locator('.plan-circle--done'),
  ).toBeVisible();
  await check(page, info, 'completed');
});

test('D20b 2: меню радара с клавиатуры на Сегодня и в радаре', async ({ page, family }, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Вымышленный срок меню' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  for (const screen of ['today', 'radar']) {
    if (screen === 'radar') await openRadar(page);
    const more = page.getByRole('button', {
      name: 'Ещё действия: Вымышленный срок меню',
      exact: true,
    });
    await more.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Действия: Вымышленный срок меню', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Отложить до…', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Не актуально', exact: true })).toBeVisible();
    await check(page, info, `${screen}-menu`);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  await check(page, info, 'radar-keyboard');
});

test('D20b 2: чужой известный ответственный, компактный радар и переход по строке', async ({
  page,
  family,
}, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Вымышленный общий срок',
    audience: 'household',
  });
  expect(
    (await api.patch(`notes/${note.id}`, { assigneeId: family.person('admin').id })).status,
  ).toBe(200);
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  const repeated = await seedNote(api, family, {
    title: 'Вымышленное обслуживание',
    audience: 'household',
  });
  await seedDeadline(api, 'notes', repeated.id, {
    kind: 'repeat',
    anchor: homeDate(-7),
    repeat: { unit: 'day', every: 1 },
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  await page.getByRole('button', { name: 'Весь дом', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Вымышленный общий срок' });
  await expect(row).toContainText('→ Анна');
  const repeatMeta = page
    .getByRole('list', { name: 'Сейчас', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'Вымышленное обслуживание' })
    .locator('.row__meta');
  await expect(repeatMeta).toContainText('Повтор,');
  await expect(repeatMeta).toContainText('сегодня');
  await expect(repeatMeta).not.toContainText('начиная');
  expect(
    await row.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(144);
  await check(page, info, 'radar-assignee');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/more/notes/${note.id}$`));
  await expect(
    page.getByRole('heading', { name: 'Вымышленный общий срок', exact: true }),
  ).toBeVisible();
});

test('D20b 1,5: ребёнок видит чужое общее дело без выполнения и переноса', async ({
  page,
  family,
}, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  expect(
    (
      await api.post('tasks', {
        title: 'Вымышленное дело взрослого',
        planOn: homeDate(0),
        placement: { spaceId: family.houseId, audience: 'household' },
      })
    ).status,
  ).toBe(201);
  await signInAs(page, family, 'child');
  const row = page
    .getByRole('list', { name: 'Дела на сегодня', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'Вымышленное дело взрослого' });
  await expect(row.getByRole('link')).toBeVisible();
  await expect(row.getByRole('button')).toHaveCount(0);
  await check(page, info, 'readonly');
});

test('D20b 5: главное повторное дело переносится только на этот раз', async ({
  page,
  family,
}, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const result = await api.post('tasks', {
    title: 'Вымышленный главный повтор',
    planOn: homeDate(0),
    planTime: '10:00',
    repeatRule: { kind: 'daily' },
    householdId: family.houseId,
  });
  expect(result.status).toBe(201);
  const original = result.body as { id: string; seriesId: string };
  expect((await api.post(`tasks/${original.id}/main`, { selected: true })).status).toBe(200);
  await signInAs(page, family, 'adult');
  await page
    .getByRole('list', { name: 'Главное дело', exact: true })
    .getByRole('button', { name: 'Перенести: Вымышленный главный повтор', exact: true })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Перенести', exact: true });
  await expect(sheet.getByRole('button', { name: 'Этот и следующие', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Без даты', exact: true })).toHaveCount(0);
  await check(page, info, 'move-repeat');
  const request = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/tasks/${original.id}`),
  );
  await sheet.getByRole('button', { name: 'Завтра', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ planOn: homeDate(1) });
  // Штатная очередь не передаёт repeatScope для одного раза: это значение API по умолчанию.
  expect(body.repeatScope ?? 'this').toBe('this');
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect
    .poll(async () => (await api.get(`tasks/${original.id}`)).body)
    .toMatchObject({
      planOn: homeDate(0),
      planTime: '10:00',
      seriesId: original.seriesId,
      repeatRule: { kind: 'daily' },
    });
});

test('D20b 5: общий перенос, дата дома и отмена', async ({ page, family }, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family, 'Pacific/Kiritimati');
  const api = await apiAs(family, 'adult');
  const today = homeDate(0, 'Pacific/Kiritimati');
  const result = await api.post('tasks', { title: 'Вымышленное дело для переноса', planOn: today });
  expect(result.status).toBe(201);
  const id = (result.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  const move = page.getByRole('button', {
    name: 'Перенести: Вымышленное дело для переноса',
    exact: true,
  });
  await move.click();
  const sheet = page.getByRole('dialog', { name: 'Перенести', exact: true });
  await sheet.getByRole('button', { name: 'Выбрать дату…', exact: true }).click();
  const date = sheet.getByLabel('Дата переноса', { exact: true });
  await expect(date).toHaveAttribute('min', today);
  await date.fill(homeDate(-1, 'Pacific/Kiritimati'));
  await expect(sheet.getByRole('button', { name: 'Перенести', exact: true })).toBeDisabled();
  await check(page, info, 'move-date');
  await sheet.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(move).toBeVisible();
  await expect
    .poll(async () => (await api.get(`tasks/${id}`)).body)
    .toMatchObject({ planOn: today });
  await check(page, info, 'move-undo');
});

test('D20b 5: перенос и отмена сразу видны без сети', async ({ page, context, family }, info) => {
  test.skip(process.env.D20B_PHASE === 'before');
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  expect(
    (await api.post('tasks', { title: 'Вымышленный перенос без сети', planOn: homeDate(0) }))
      .status,
  ).toBe(201);
  await signInAs(page, family, 'adult');
  const move = page.getByRole('button', {
    name: 'Перенести: Вымышленный перенос без сети',
    exact: true,
  });
  await move.click();
  await context.setOffline(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве. Отправим при появлении сети.', { exact: true }),
  ).toBeVisible();
  await expect(move).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(move).toBeVisible();
  await check(page, info, 'move-offline');
  await context.setOffline(false);
  await expect(page.getByRole('link', { name: /^Очередь изменений/ })).toHaveCount(0);
  await expect(move).toBeVisible();
});
