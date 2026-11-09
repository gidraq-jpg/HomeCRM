import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { apiAs, seedNote, seedObject } from './notes-support.ts';
import { seedPerson } from './people-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

// D48 (UI-12): плотные экраны, одна плавающая «+» и мгновенный возврат в раздел.
// Снимки лежат в test-results/d48.
const SHOTS = resolve(import.meta.dirname, '../../test-results/d48');

const SCREENS = [
  { name: 'today', route: '/today', add: 'Добавить' },
  { name: 'home', route: '/home', add: 'Добавить объект' },
  { name: 'documents', route: '/documents', add: 'Добавить документ' },
  { name: 'people', route: '/people', add: 'Добавить человека' },
  { name: 'notes', route: '/more/notes', add: 'Добавить заметку' },
] as const;

async function expectFabClear(page: Page) {
  const fab = page.locator('.chrome .fab');
  await expect(fab).toHaveCount(1);
  const box = await fab.boundingBox();
  const nav = await page.locator('.bottom-nav').boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(56);
  expect(box?.height).toBe(56);
  // Над нижним меню и у правого края.
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(nav?.y ?? 0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(box?.x ?? 0).toBeGreaterThan((viewport?.width ?? 0) / 2);
  // Внизу страницы последняя строка и стрелка «›» не закрыты кнопкой.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  const lastRow = page.locator('main .row-list > li, main .task-row').last();
  if (await lastRow.count()) {
    const row = await lastRow.boundingBox();
    const after = await fab.boundingBox();
    expect(row && after && row.y + row.height <= after.y + 1).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('D48: одна плавающая «+» на пяти экранах, без строк «Добавить …» и полос', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  mkdirSync(SHOTS, { recursive: true });
  const api = await apiAs(family, 'adult');
  for (let i = 1; i <= 8; i++) {
    if (i === 1)
      await seedProperty(api, family, { title: `Квартира плотности ${i}`, audience: 'household' });
    else await seedObject(api, family, { title: `Объект плотности ${i}` });
    await seedNote(api, family, { title: `Заметка плотности ${i}` });
    await seedPerson(api, { title: `Человек плотности ${i}` });
    await seedDocument(api, {
      title: `Документ плотности ${i}`,
      type: 'other',
      ...(i === 1 ? { expiresOn: homeDate(10) } : {}),
    });
    expect(
      (await api.post('tasks', { title: `Дело плотности ${i}`, planOn: homeDate(0) })).status,
    ).toBe(201);
  }
  await signInAs(page, family, 'adult');
  for (const screen of SCREENS) {
    await page.goto(`#${screen.route}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
    await expect(page.getByText(/Загружаем/)).toHaveCount(0);
    await settle(page);
    await expect(page.getByRole('button', { name: screen.add, exact: true })).toBeVisible();
    await expect(page.locator('main .studio-add, main .list-add')).toHaveCount(0);
    // Нет кнопок «Добавить …» в списках: единственная — плавающая.
    await expect(page.getByRole('button', { name: /^Добавить/ })).toHaveCount(1);
    await expectFabClear(page);
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await expectAccessible(page, `d48-${screen.name}`);
    await page.screenshot({ path: resolve(SHOTS, `${screen.name}-${info.project.name}.png`) });
  }
  // Заголовок раздела и счётчик — в одной строке.
  await page.goto('#/home');
  const line = page.locator('.studio-list-hero .page-heading__line');
  await expect(line).toContainText('Дом');
  await expect(line).toContainText('8');
  const h1 = await line.locator('h1').boundingBox();
  const count = await line.locator('.studio-list-count').boundingBox();
  expect(
    Math.abs((h1?.y ?? 0) + (h1?.height ?? 0) - ((count?.y ?? 0) + (count?.height ?? 0))),
  ).toBeLessThan(12);
  // Сводка «Коммуналка за …» вместо текстовой кнопки.
  await expect(page.getByRole('link', { name: /^Коммуналка за / })).toBeVisible();
  // Документы: счётчик «Истекают · 1».
  await page.goto('#/documents');
  await expect(page.getByRole('radio', { name: 'Истекают · 1', exact: true })).toBeAttached();
  await expect(page.getByRole('radio', { name: /^Просрочены$/ })).toBeAttached();
  // «Все дела»: число открытых дел названо один раз.
  await page.goto('#/today/all');
  await expect(page.getByText(/открытых дел|открытое дело|открытых дела/)).toHaveCount(1);
});

test('D48: «Все дела» и карточка объекта — плотная шапка, фильтры одной строкой, вкладки в одну строку', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, {
    title: 'Квартира карточки',
    audience: 'household',
  });
  for (let i = 1; i <= 4; i++)
    expect(
      (await api.post('tasks', { title: `Дело ленты ${i}`, planOn: homeDate(0) })).status,
    ).toBe(201);
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: /Дело ленты 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Фильтры/ })).toBeVisible();
  await expect(page.locator('[data-feed-active="true"] .studio-filters')).toHaveCount(0);
  await expect(page.locator('[data-feed-active="true"] .task-filters')).toContainText('Все');
  await page.screenshot({ path: resolve(SHOTS, `all-tasks-${info.project.name}.png`) });
  await page.goto(`#/home/${property.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Квартира карточки' })).toBeVisible();
  await settle(page);
  const access = await page.locator('.object-access-trigger').boundingBox();
  const type = await page.locator('.object-hero__type').boundingBox();
  expect(
    Math.abs(
      (type?.y ?? 0) + (type?.height ?? 0) / 2 - ((access?.y ?? 0) + (access?.height ?? 0) / 2),
    ),
  ).toBeLessThan(8);
  // Вкладки всегда в одну строку: все ссылки на одной высоте, полосы прокрутки нет.
  for (const route of [`/home/${property.id}`, '/today', '/people']) {
    await page.goto(`#${route}`);
    await settle(page);
    const tops = await page
      .locator('.tabs__link')
      .evaluateAll((links) =>
        links
          .filter((l) => l.getBoundingClientRect().width > 0)
          .map((l) => Math.round(l.getBoundingClientRect().top)),
      );
    expect(new Set(tops).size, `вкладки ${route} в одну строку`).toBeLessThanOrEqual(1);
  }
  await page.goto(`#/home/${property.id}`);
  await settle(page);
  await page.screenshot({ path: resolve(SHOTS, `object-card-${info.project.name}.png`) });
  // «+» не закрывает свёрнутые строки внизу карточки.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  const fab = await page.locator('.chrome .fab').boundingBox();
  const last = await page
    .locator('.object-panel details, .object-panel section')
    .last()
    .boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual((fab?.y ?? 0) + 1);
  await page.screenshot({ path: resolve(SHOTS, `object-card-bottom-${info.project.name}.png`) });
});

test('D48: повторный переход в раздел показывает данные сразу, без индикатора загрузки', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Кэш не зависит от ширины.');
  const api = await apiAs(family, 'adult');
  for (let i = 1; i <= 3; i++) await seedObject(api, family, { title: `Кэш-объект ${i}` });
  await signInAs(page, family, 'adult');
  await page.goto('#/home');
  await expect(page.getByRole('link', { name: /Кэш-объект 1/ })).toBeVisible();
  await page.goto('#/documents');
  await expect(page.getByRole('heading', { level: 1, name: 'Документы' })).toBeVisible();
  // Сервер отвечает на список объектов медленно: возврат всё равно мгновенный.
  await page.route('**/api/objects?*', async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Дом', exact: true }).click();
  await expect(page.getByRole('link', { name: /Кэш-объект 1/ })).toBeVisible({ timeout: 700 });
  await expect(page.getByText(/Загружаем объекты/)).toHaveCount(0);
  await page.unroute('**/api/objects?*');
});

test('D48: кэш не хранится на устройстве', async ({ page, family }, info) => {
  test.skip(info.project.name !== 'w360', 'Хранилище не зависит от ширины.');
  const api = await apiAs(family, 'adult');
  await seedObject(api, family, { title: 'Объект без следа' });
  await signInAs(page, family, 'adult');
  await page.goto('#/home');
  await expect(page.getByRole('link', { name: /Объект без следа/ })).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]).includes(
      'Объект без следа',
    ),
  );
  expect(stored).toBe(false);
});
