import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { TaskCard } from '../../src/tasks/api.ts';
import { type DateOnly, formatLongDate } from '../../src/ui/format.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openQuick,
  setScope,
} from '../support/helpers.ts';
import { homeDate, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedObject } from './notes-support.ts';
import { signInAs } from './support.ts';

async function shot(page: Page, name: string) {
  if (process.platform !== 'linux') return;
  const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/UI-2');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}
async function check(page: Page, name: string) {
  await shot(page, name);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, name);
}
async function openFeed(page: Page, view: 'today' | 'plan' | 'all') {
  await page.goto(view === 'today' ? '#/today' : `#/today/${view}`);
  await expect(page.getByText('Загружаем дела…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    view === 'today' ? 'Сегодня' : view === 'plan' ? 'План' : 'Все дела',
  );
}
async function expectGap(page: Page, first: string, second: string, minimum: number) {
  const before = await page.locator(first).boundingBox();
  const after = await page.locator(second).boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect((after?.y ?? 0) - ((before?.y ?? 0) + (before?.height ?? 0))).toBeGreaterThanOrEqual(
    minimum,
  );
}

test('пустые ленты: исходный фокус, подписи и отдельная группа действий', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  await signInAs(page, family, 'admin');
  const width = info.project.use.viewport?.width;
  for (const view of ['today', 'plan', 'all'] as const) {
    await openFeed(page, view);
    await expect(page.getByRole('link', { name: 'Новое дело', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Пригласить участника' })).toBeVisible();
    if (view === 'today') {
      await expect(page.getByRole('heading', { name: 'Что сегодня важнее всего?' })).toBeVisible();
      await expect(page.locator('.page-heading__eyebrow')).toContainText(
        formatLongDate(homeDate(0) as DateOnly),
      );
      await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
    }
    if (view === 'all')
      await expect(page.locator('.page-heading__eyebrow')).toHaveText('Дела дома и ваши личные');
    await expectGap(page, '.task-actions > a', '.task-actions__help', 8);
    await check(page, `empty-${view}-${width}`);
  }
});

test('быстрая строка: отступы, длинные чипы, ошибка и сохранение без потери ввода', async ({
  page,
  family,
  context,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedObject(api, family, {
    title: `Квартира${'ОченьДлинноеНазвание'.repeat(6)}`,
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  await openQuick(page);
  const section = page.locator('.sheet .section');
  const input = section.getByLabel('Быстрая строка');
  await expect(input).toBeVisible();
  // Геометрию меряем после входа листа: transform меняет промежутки во время анимации.
  await page.getByRole('dialog', { name: 'Новое дело', exact: true }).evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  const hint = await section.locator('p').first().boundingBox();
  const field = await input.boundingBox();
  const submit = await section
    .getByRole('button', { name: 'Добавить дело', exact: true })
    .boundingBox();
  expect
    .soft((hint?.y ?? 0) - ((field?.y ?? 0) + (field?.height ?? 0)), 'отступ поля от подсказки')
    .toBeGreaterThanOrEqual(8);
  expect
    .soft((submit?.y ?? 0) - ((hint?.y ?? 0) + (hint?.height ?? 0)), 'отступ подсказки от отправки')
    .toBeGreaterThanOrEqual(8);
  const title = 'ПроверитьДокументы'.repeat(8);
  const raw = `${title} завтра в 10:00 @Борис #${object.title}`;
  await input.fill(raw);
  await expect(page.getByRole('button', { name: /^Убрать объект:/ })).toBeVisible();
  await check(page, `quickline-chips-${info.project.use.viewport?.width}`);
  const sentBodies: string[] = [];
  context.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tasks')
      sentBodies.push(request.postData() ?? '');
  });
  await context.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":"TEST_FAILURE"}',
      });
    } else await route.continue();
  });
  await section.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue(raw);
  await expectGap(page, 'form.task-quickline', 'form.task-quickline + .auth-notice', 8);
  await check(page, `quickline-error-${info.project.use.viewport?.width}`);
  await input.fill('Изменённый ввод после неизвестного COMMIT');
  await section.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Исход отправки ещё неизвестен');
  expect(new Set(sentBodies).size).toBe(1);
  await input.fill(raw);
  await context.unroute('**/api/tasks');
  await section.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  expect(sentBodies.length).toBeGreaterThanOrEqual(2);
  expect(new Set(sentBodies).size).toBe(1);
  expect(JSON.parse(sentBodies[0] ?? '{}')).toMatchObject({
    offline: true,
    idempotencyKey: expect.any(String),
    ownerAccountId: family.person('adult').id,
  });
  const rows = (await api.get('tasks?scope=all')).body as { title: string }[];
  expect(rows.filter((row) => row.title === title)).toHaveLength(1);
});

test('заполненные ленты: главное перед вводом, длинный заголовок, выполнение и отмена', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const title = `Подготовить документы для ремонта ${'ОченьДлинноеНазвание'.repeat(5)}`;
  const created = await api.post('tasks', { title, planOn: homeDate(0) });
  expect(created.status).toBe(201);
  const main = TaskCard.parse(created.body);
  await api.post(`tasks/${main.id}/main`, { selected: true });
  await api.post('tasks', { title: 'Позвонить мастеру завтра', planOn: homeDate(1) });
  await api.post('tasks', { title: 'Разобрать вымышленные бумаги без даты' });
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
  await check(page, `main-today-${info.project.use.viewport?.width}`);
  await page
    .getByRole('list', { name: 'Главное дело' })
    .getByRole('button', { name: 'Выполнить', exact: true })
    .click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await family.database.admin.query('SELECT status FROM tasks WHERE id=$1', [main.id]))
          .rows[0]?.status,
    )
    .toBe('open');
  for (const view of ['plan', 'all'] as const) {
    await openFeed(page, view);
    await expect(
      page.getByRole('link', { name: /Разобрать вымышленные бумаги без даты/ }),
    ).toBeVisible();
    await check(page, `filled-${view}-${info.project.use.viewport?.width}`);
  }
});

test('настольные ленты 1440 и 1718 px, масштаб 100% и 200%', async ({ browser, family }, info) => {
  test.skip(info.project.name !== 'w412', 'Одна проверка одинаковых настольных размеров');
  test.setTimeout(120_000);
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Подготовить документы для ремонта',
    planOn: homeDate(0),
  });
  expect(created.status).toBe(201);
  const main = TaskCard.parse(created.body);
  await api.post(`tasks/${main.id}/main`, { selected: true });
  for (const width of [1440, 1718])
    for (const zoom of [1, 2]) {
      // При 200% CSS-окно вдвое уже, плотность пикселей вдвое выше: как при масштабе браузера.
      const context = await browser.newContext({
        viewport: { width: width / zoom, height: 1000 / zoom },
        deviceScaleFactor: zoom,
        isMobile: false,
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
      });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', () => errors.push('Unhandled browser exception'));
        await signInAs(page, family, 'adult');
        for (const view of ['today', 'plan', 'all'] as const) {
          await openFeed(page, view);
          await check(page, `desktop-${view}-${width}-${zoom * 100}`);
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
});

test('Studio: реальные показатели, пространство, независимая ошибка и текст 200%', async ({
  page,
  family,
  context,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const name = `Борис${'ОченьДлинноеИмя'.repeat(5)}`;
  expect(await api.patch('me/profile', { displayName: name })).toMatchObject({ status: 200 });
  expect(
    await api.post('tasks', { title: 'Личное дело сегодня', planOn: homeDate(0) }),
  ).toMatchObject({ status: 201 });
  expect(
    await api.post('tasks', {
      title: 'Общее просроченное дело',
      planOn: homeDate(-1),
      placement: { spaceId: family.houseId, audience: 'household' },
    }),
  ).toMatchObject({ status: 201 });
  const personal = await seedObject(api, family, { title: 'Личная вымышленная техника' });
  const shared = await seedObject(api, family, {
    title: 'Общая вымышленная дача',
    audience: 'household',
  });
  await seedDeadline(api, 'objects', personal.id, { kind: 'date', date: homeDate(3) });
  await seedDeadline(api, 'objects', shared.id, { kind: 'date', date: homeDate(5) });
  await recalc(family);
  let releaseObjects: () => void = () => {};
  const objectsGate = new Promise<void>((resolve) => {
    releaseObjects = resolve;
  });
  await context.route('**/api/objects?**', async (route) => {
    await objectsGate;
    await route.continue();
  });
  await signInAs(page, family, 'adult');
  const metrics = page.getByRole('navigation', { name: 'Показатели на сегодня' });
  await expect(page.locator('.today-hero__greeting')).toContainText(name);
  await expect(metrics.getByRole('link', { name: /объектов: Загружаем/ })).toContainText('—');
  releaseObjects();
  await expect(metrics.getByRole('link', { name: '2 дела сегодня', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '2 объекта', exact: true })).toBeVisible();
  await context.unroute('**/api/objects?**');
  await expect(metrics.getByRole('link', { name: '4 близких срока', exact: true })).toBeVisible();
  await check(page, `studio-counters-${info.project.use.viewport?.width}`);
  await setScope(page, 'Личное');
  await expect(metrics.getByRole('link', { name: '1 дело сегодня', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '1 объект', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '2 близких срока', exact: true })).toBeVisible();
  await metrics.getByRole('link', { name: '2 близких срока', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`view=mine&householdId=${family.houseId}$`));
  await expect(page.getByRole('heading', { name: 'Радар', exact: true })).toBeVisible();
  const radarResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/deadlines',
  );
  await page.reload();
  const radarQuery = new URL((await radarResponse).url()).searchParams;
  expect(radarQuery.get('householdId')).toBe(family.houseId);
  expect(radarQuery.get('view')).toBe('mine');
  expect(radarQuery.get('scope')).toBe('personal');
  await expect(
    page.getByRole('button', { name: 'Пространство: Личное', exact: true }),
  ).toBeVisible();
  await page.goto('#/today');
  await metrics.getByRole('link', { name: '1 объект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Дом', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Пространство: Личное', exact: true }),
  ).toBeVisible();
  await context.route('**/api/objects?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":"TEST_FAILURE"}',
    }),
  );
  await page.goto('#/today');
  await page.reload();
  await expect(metrics.getByRole('link', { name: /объектов: Нет данных/ })).toContainText('—');
  await expect(metrics.getByRole('link', { name: '1 дело сегодня', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, `studio-error-text200-${info.project.use.viewport?.width}`);
});
