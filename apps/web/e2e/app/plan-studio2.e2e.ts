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
import { apiAs, seedObject } from './notes-support.ts';
import { signInAs } from './support.ts';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => process.stdout.write(`Browser failure: ${error.message}\n`));
});

async function check(page: Page, name: string) {
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, name);
  if (process.platform === 'linux') {
    const directory = resolve(import.meta.dirname, '../../test-results/screens/TASK-5');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
  }
}
async function stored(
  page: Page,
  table = 'outbox',
): Promise<{ state: string; body: Record<string, unknown>; path: string }[]> {
  return page.evaluate(
    (name) =>
      new Promise((done, reject) => {
        const request = indexedDB.open('homecrm-offline');
        request.onerror = () => reject(new Error('Test database unavailable'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(name, 'readonly');
          const rows = tx.objectStore(name).getAll();
          rows.onsuccess = () =>
            done(
              (
                rows.result as {
                  createdAt: number;
                  state: string;
                  body: Record<string, unknown>;
                  path: string;
                }[]
              ).sort((a, b) => a.createdAt - b.createdAt),
            );
          tx.oncomplete = () => db.close();
        };
      }),
    table,
  );
}
async function plan(page: Page) {
  await page.goto('#/today/plan');
  await expect(page.getByRole('heading', { name: 'План', exact: true })).toHaveCount(1);
  await expect(page.getByRole('status', { name: 'Загружаем дела…', exact: true })).toHaveCount(0);
}

for (const textScale of [1, 2]) {
  test(`TASK-5/12: строки, перенос, повтор, прокрутка и возврат; текст ${textScale * 100}%`, async ({
    page,
    family,
  }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    const object = await seedObject(api, family, {
      title: 'Вымышленная дача',
      audience: 'household',
    });
    const base = { placement: { spaceId: family.houseId, audience: 'household' } };
    for (const fields of [
      { title: 'Полить растения', planOn: homeDate(0), planTime: '18:00', objectId: object.id },
      { title: 'Проверить фильтр', planOn: homeDate(3), repeatRule: { kind: 'daily' } },
      {
        title: 'Дождаться справки',
        planOn: homeDate(3),
        status: 'waiting',
        dueOn: homeDate(-1),
        checkOn: homeDate(3),
        waitingAccountId: family.person('admin').id,
        assigneeId: family.person('admin').id,
      },
      { title: 'Разобрать кладовку', planOn: homeDate(12) },
      { title: 'Проверить запас', planOn: homeDate(16) },
      { title: 'Прочитать инструкцию' },
      { title: 'Просроченное вымышленное дело', planOn: homeDate(-1) },
    ])
      expect((await api.post('tasks', { ...base, ...fields })).status).toBe(201);
    await signInAs(page, family, 'adult');
    if (textScale === 2)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
    await expect(
      page
        .locator('[data-feed-active="true"]')
        .getByText('Просроченное вымышленное дело', { exact: true }),
    ).toBeVisible();
    await plan(page);
    const width = info.project.use.viewport?.width;
    await expect(page.getByText('18:00 · Вымышленная дача · Вся семья')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Повторяется' })).toBeVisible();
    await expect(
      page.locator('[data-feed-active="true"]').getByText('→ Анна', { exact: false }),
    ).toBeVisible();
    await expect(page.locator('[data-feed-active="true"] .plan-circle--waiting')).toBeVisible();
    await expect(page.getByText(/· свободно/).first()).toBeVisible();
    // Просрочка — срок dueOn; прошедший день плана сам по себе её не добавляет.
    await expect(page.getByRole('link', { name: /1 просроченное дело/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Новое дело', exact: true })).toHaveCount(0);
    await check(page, `plan-${textScale * 100}-${width}`);
    await page.getByRole('button', { name: 'Перенести: Полить растения', exact: true }).click();
    await page.getByRole('button', { name: 'Завтра', exact: true }).click();
    await expect(page.getByText(/^Перенесено на/)).toBeVisible();
    await expect(
      page
        .locator('.plan-day')
        .filter({ has: page.getByRole('heading', { name: 'Завтра', exact: true }) })
        .getByRole('link', { name: 'Полить растения', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(
      page
        .locator('.plan-day')
        .filter({ has: page.getByRole('heading', { name: 'Сегодня', exact: true }) })
        .getByRole('link', { name: 'Полить растения', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Перенести: Проверить фильтр', exact: true }).click();
    await page.getByRole('button', { name: 'Только этот раз', exact: true }).click();
    await page.getByRole('button', { name: 'Завтра', exact: true }).click();
    await expect(page.getByText(/^Перенесено на/)).toBeVisible();
    await page.locator('.plan-undated summary').click();
    await page.getByRole('button', { name: 'Назначить день: Прочитать инструкцию' }).click();
    await expect(page.getByRole('dialog', { name: 'Назначить день', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Без даты', exact: true })).toHaveCount(0);
    await check(page, `assign-day-${textScale * 100}-${width}`);
    await page.getByRole('button', { name: 'Завтра', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 600));
    const tabs = page.locator('.today-tabs');
    const header = page.locator('.topbar');
    await expect
      .poll(async () =>
        Math.abs(
          ((await tabs.boundingBox())?.y ?? -1000) -
            (((await header.boundingBox())?.y ?? 0) + ((await header.boundingBox())?.height ?? 0)),
        ),
      )
      .toBeLessThan(2);
    await expect(tabs.getByRole('button', { name: 'Добавить дело', exact: true })).toBeInViewport();
    if (process.platform === 'linux') {
      const directory = resolve(import.meta.dirname, '../../test-results/screens/TASK-5');
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(directory, `plan-sticky-${textScale * 100}-${width}.png`),
      });
    }
    // Настоящее колесо прокрутки включает IntersectionObserver, а не только запасную кнопку.
    await page.mouse.wheel(0, 10000);
    await expect(page.getByRole('link', { name: 'Проверить запас', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Показать следующие дни' }).click();
    await expect(page.getByText('Загружаем…', { exact: true })).toHaveCount(0);
    await page
      .getByRole('link', { name: 'Разобрать кладовку', exact: true })
      .scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await page.getByRole('link', { name: 'Разобрать кладовку', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Разобрать кладовку', exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 3);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(y + 3);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      window.scrollTo(0, 400);
    });
    await check(page, `plan-text200-${width}`);
  });
}

test('TASK-12: без сети following недоступен, this в очереди и отмена сохраняет дату и время', async ({
  page,
  context,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Вымышленный повтор офлайн',
    planOn: homeDate(0),
    planTime: '09:00',
    repeatRule: { kind: 'daily' },
    householdId: family.houseId,
  });
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await plan(page);
  await page.getByRole('button', { name: 'Перенести: Вымышленный повтор офлайн' }).click();
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Этот и следующие · Нужна сеть' })).toBeDisabled();
  await check(page, `repeat-offline-${info.project.use.viewport?.width}`);
  await page.getByRole('button', { name: 'Только этот раз', exact: true }).click();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве. Отправим при появлении сети.'),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await stored(page)).filter((row) => row.path === `tasks/${id}` && row.state === 'pending')
          .length,
    )
    .toBe(1);
  expect((await stored(page))[0]?.body).toMatchObject({ planOn: homeDate(1), offline: true });
  expect((await stored(page))[0]?.body).not.toHaveProperty('repeatScope');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await stored(page)).filter((row) => row.path === `tasks/${id}` && row.state === 'pending')
          .length,
    )
    .toBe(2);
  expect((await stored(page)).at(-1)?.body).toMatchObject({
    planOn: homeDate(0),
    planTime: '09:00',
  });
  await context.setOffline(false);
  await expect
    .poll(async () => (await stored(page)).every((row) => row.state === 'confirmed'))
    .toBe(true);
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    planOn: homeDate(0),
    planTime: '09:00',
  });
});

test('TASK-12: потеря сети во время following даёт NETWORK_REQUIRED без очереди', async ({
  page,
  family,
}) => {
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Вымышленная сетевая серия',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
    householdId: family.houseId,
  });
  expect(created.status).toBe(201);
  await setHomeZone(family);
  await signInAs(page, family, 'adult');
  await plan(page);
  await page.getByRole('button', { name: 'Перенести: Вымышленная сетевая серия' }).click();
  await page.getByRole('button', { name: 'Этот и следующие', exact: true }).click();
  await page.route('**/api/tasks/*', async (route) =>
    route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByText('Для этого действия нужно подключение к сети.')).toHaveCount(1);
  expect(await stored(page)).toHaveLength(0);
});

test('TASK-5: пустой план, вкладки с плюсом, доступность и текст 200%', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await plan(page);
  await expect(page.getByText('На две недели вперёд дел нет', { exact: true })).toBeVisible();
  await expect(
    page.locator('.today-tabs').getByRole('button', { name: 'Добавить дело', exact: true }),
  ).toBeVisible();
  await check(page, `empty-${info.project.use.viewport?.width}`);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, `empty-text200-${info.project.use.viewport?.width}`);
});

test('TASK-12: Без даты сбрасывает время, отмена возвращает его; произвольная дата', async ({
  page,
  family,
}) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Вымышленное дело со временем',
    planOn: homeDate(0),
    planTime: '09:00',
    householdId: family.houseId,
  });
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await plan(page);
  await page.getByRole('button', { name: 'Перенести: Вымышленное дело со временем' }).click();
  await page.getByRole('button', { name: 'Без даты', exact: true }).click();
  await expect(page.getByText('Перенесено в «Без даты»', { exact: true })).toBeVisible();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({ planOn: null, planTime: null });
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Перенос отменён', { exact: true })).toBeVisible();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    planOn: homeDate(0),
    planTime: '09:00',
  });
  await page.getByRole('button', { name: 'Перенести: Вымышленное дело со временем' }).click();
  await page.getByRole('button', { name: 'Выбрать дату…', exact: true }).click();
  await page.getByLabel('Дата переноса', { exact: true }).fill(homeDate(2));
  await page.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    planOn: homeDate(2),
    planTime: '09:00',
  });
});

test('TASK-12: обычный перенос и Назначить день сохраняются офлайн', async ({
  page,
  context,
  family,
}) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  for (const fields of [
    { title: 'Вымышленное обычное дело', planOn: homeDate(0) },
    { title: 'Вымышленное дело без даты' },
  ]) {
    expect((await api.post('tasks', { ...fields, householdId: family.houseId })).status).toBe(201);
  }
  await signInAs(page, family, 'adult');
  await plan(page);
  // Сеть отключается после загрузки строки, а не после одного заголовка страницы.
  await expect(
    page.getByRole('button', { name: 'Перенести: Вымышленное обычное дело' }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Перенести: Вымышленное обычное дело' }).click();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве. Отправим при появлении сети.'),
  ).toBeVisible();
  await page.locator('.plan-undated summary').click();
  await page.getByRole('button', { name: 'Назначить день: Вымышленное дело без даты' }).click();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).filter((row) => row.state === 'pending').length)
    .toBe(2);
  for (const row of await stored(page))
    expect(row.body).toMatchObject({ planOn: homeDate(1), offline: true });
  await context.setOffline(false);
  await expect
    .poll(async () => (await stored(page)).every((row) => row.state === 'confirmed'))
    .toBe(true);
});
