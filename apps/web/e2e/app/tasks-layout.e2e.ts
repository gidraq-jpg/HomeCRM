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
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedObject } from './notes-support.ts';
import { signInAs } from './support.ts';

async function shot(page: Page, name: string) {
  if (process.platform !== 'linux') return;
  const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/R1c.4d/after');
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
      await expectGap(page, '.task-focus', 'form', 16);
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
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedObject(api, family, {
    title: `Квартира${'ОченьДлинноеНазвание'.repeat(6)}`,
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  const section = page
    .locator('.section')
    .filter({ has: page.getByRole('heading', { name: 'Быстро добавить', exact: true }) });
  const input = section.getByLabel('Быстрая строка');
  await expect(input).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Снять чип: Объект' })).toBeVisible();
  await check(page, `quickline-chips-${info.project.use.viewport?.width}`);
  await page.route('**/api/tasks', async (route) => {
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
  await page.unroute('**/api/tasks');
  await section.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
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
  await expectGap(page, '.task-focus', 'form.task-quickline', 16);
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
