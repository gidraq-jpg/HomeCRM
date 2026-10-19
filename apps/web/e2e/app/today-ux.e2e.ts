import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, recalc, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await expectAccessible(page, `D20a-${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const directory = resolve(import.meta.dirname, '../../test-results/screens/D20a');
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: resolve(directory, `${name}-${info.project.name}.png`),
      fullPage: true,
    });
  }
}

/** Реальные touch events проходят через pointer events и браузерный touch-action. */
async function swipe(page: Page, forward: boolean) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise(requestAnimationFrame);
  });
  const session = await page.context().newCDPSession(page);
  const width = page.viewportSize()?.width ?? 360;
  const content = page.url().endsWith('/today/plan')
    ? page.getByText('На две недели вперёд дел нет', { exact: true })
    : page.url().endsWith('/more/shopping')
      ? page.locator('.shopping-page .studio-list-summary')
      : page.locator('main .page-heading');
  await expect(content).toBeVisible();
  const y = await content.evaluate(
    (element) =>
      element.getBoundingClientRect().top +
      Math.min(30, element.getBoundingClientRect().height / 2),
  );
  const from = forward ? width - 60 : 60;
  const to = forward ? 60 : width - 60;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from, y }],
  });
  for (let step = 1; step <= 6; step++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from + ((to - from) * step) / 6, y }],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

async function syntheticSwipe(page: Page, selector: string, x = 280, y = 10) {
  await page
    .locator(selector)
    .first()
    .evaluate(
      (element, point) => {
        const init = {
          bubbles: true,
          pointerType: 'touch',
          isPrimary: true,
          pointerId: 91,
          clientX: point.x,
          clientY: point.y,
        };
        element.dispatchEvent(new PointerEvent('pointerdown', init));
        element.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: 45 }));
      },
      { x, y },
    );
}

test('D20a 1,4,5,8: личное главное дело, устройства, единственное добавление и радар без дубля', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Проверить вымышленный фильтр',
    planOn: homeDate(0),
    dueOn: homeDate(-1),
  });
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  expect((await api.post(`tasks/${id}/main`, { selected: true })).status).toBe(200);
  const note = await seedNote(api, family, { title: 'Вымышленный срок без дела' });
  expect(
    (
      await api.post(`notes/${note.id}/deadlines`, {
        rule: { kind: 'date', date: homeDate(0), warnings: [0] },
      })
    ).status,
  ).toBe(201);
  await recalc(family);
  await signInAs(page, family, 'adult');
  await expect(
    page.getByRole('heading', { name: 'Главное на сегодня', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Проверить вымышленный фильтр', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Вымышленный срок без дела', { exact: true })).toBeVisible();
  await check(page, info, 'today');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Добавить', exact: true });
  await expect(menu.getByText('Дело', { exact: true })).toHaveCount(1);
  await expect(menu.getByText('Новое дело', { exact: true })).toHaveCount(0);
  await expect(menu.getByText('Из шаблона', { exact: true })).toBeVisible();
  await check(page, info, 'add-menu');
  await menu.getByText('Дело', { exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /Полная форма/ })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.goto('#/more/settings');
  const toggle = page.getByRole('switch', { name: 'Главное дело на «Сегодня»' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  expect((await api.get('notifications/settings')).body).toMatchObject({ todayMainEnabled: false });
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.security-list strong').first()).toContainText(
    /(?:Chrome|Браузер) на/,
  );
  await expect(page.getByText(/^Последний вход:/).first()).toBeVisible();
  await check(page, info, 'settings');
  await page.goto('#/today');
  await expect(page.getByRole('heading', { name: 'Главное на сегодня', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Выбрать главное дело', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Проверить вымышленный фильтр', { exact: true })).toBeVisible();
  await page.goto(`#/today/tasks/${id}`);
  await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
  await expect(page.getByRole('button', { name: /Сделать главным|Снять главное/ })).toHaveCount(0);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    locale: 'ru-RU',
    isMobile: true,
    hasTouch: true,
  });
  try {
    const second = await context.newPage();
    await second.goto(family.baseURL);
    await signInAs(second, family, 'adult');
    await second.goto('#/more/settings');
    const secondToggle = second.getByRole('switch', { name: 'Главное дело на «Сегодня»' });
    await expect(secondToggle).not.toBeChecked();
    await secondToggle.check();
    await expect(secondToggle).toBeChecked();
    await expect(secondToggle).toBeEnabled();
  } finally {
    await context.close();
  }
  await page.goto('#/today');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Главное на сегодня', exact: true }),
  ).toBeVisible();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({ isMain: true, status: 'open' });
});

test('D20a 2: свайп по четырём вкладкам, границы и исключения', async ({ page, family }, info) => {
  await signInAs(page, family, 'adult');
  const paths = ['/today', '/today/plan', '/today/all', '/more/shopping'];
  await swipe(page, false);
  await expect(page).toHaveURL(/#\/today$/);
  for (const path of paths.slice(1)) {
    await swipe(page, true);
    await expect(page).toHaveURL(new RegExp(`#${path}$`));
    await expect(page.locator('.today-tabs [aria-current="page"]')).toBeFocused();
    await check(page, info, `swipe-${path.split('/').at(-1)}`);
  }
  await swipe(page, true);
  await expect(page).toHaveURL(/#\/more\/shopping$/);
  for (const path of paths.slice(0, -1).reverse()) {
    await swipe(page, false);
    await expect(page).toHaveURL(new RegExp(`#${path}$`));
    await expect(page.locator('.today-tabs [aria-current="page"]')).toBeFocused();
  }
  for (const x of [10, (page.viewportSize()?.width ?? 360) - 10]) {
    await syntheticSwipe(page, '.today-hero', x);
    await expect(page).toHaveURL(/#\/today$/);
  }
  await syntheticSwipe(page, '.today-tabs');
  await expect(page).toHaveURL(/#\/today$/);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await syntheticSwipe(page, '.today-hero');
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  // Вертикальный жест по-прежнему прокручивает ленту.
  await page.evaluate(() => window.scrollTo(0, 0));
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 180, y: 550 }],
  });
  for (let step = 1; step <= 8; step++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 180, y: 550 - step * 40 }],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page).toHaveURL(/#\/today$/);
});

test('D20a 6,7,9: перенос из карточки, dock 200%, время и место тоста', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const result = await api.post('tasks', {
    title: 'Разобрать вымышленную полку',
    planOn: homeDate(0),
    dueOn: homeDate(2),
  });
  expect(result.status).toBe(201);
  const id = (result.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${id}`);
  await page.getByRole('button', { name: 'Перенести дело по дате срока' }).click();
  await check(page, info, 'reschedule');
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    planOn: homeDate(1),
    dueOn: homeDate(2),
  });
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByText('Перенос отменён', { exact: true })).toBeVisible();
  const start = Date.now();
  await expect(page.getByText('Перенос отменён', { exact: true })).toHaveCount(0, {
    timeout: 6000,
  });
  expect(Date.now() - start).toBeGreaterThan(3500);
  expect(Date.now() - start).toBeLessThan(5500);
  await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
  await expect(page.getByRole('button', { name: 'Передать…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Перенести…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Перенести', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await check(page, info, 'dock-200');
  const dock = page.getByRole('navigation', { name: 'Основные разделы' });
  const documents = dock.getByRole('link', { name: 'Документы', exact: true });
  await expect(documents).toBeVisible();
  expect(await documents.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const boxes = await page.evaluate(() => {
    const toast = document.querySelector('.toast')?.getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const action = document.querySelector('.ui6-primary')?.getBoundingClientRect();
    return {
      toastBottom: toast?.bottom ?? 0,
      toastTop: toast?.top ?? 0,
      navTop: nav?.top ?? 0,
      actionBottom: action?.bottom ?? 0,
      actionTop: action?.top ?? 0,
    };
  });
  expect(boxes.toastBottom).toBeLessThanOrEqual(boxes.navTop);
  expect(boxes.actionBottom <= boxes.toastTop || boxes.actionTop >= boxes.toastBottom).toBe(true);
});

test('D20a 3: CLS при медленной загрузке Сегодня ≤ 0,1, вкладки и плюс неподвижны', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'adult');
  await page.addInitScript(() => {
    (window as unknown as { todayCLS: number }).todayCLS = 0;
    new PerformanceObserver((list) => {
      for (const item of list.getEntries()) {
        const shift = item as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput)
          (window as unknown as { todayCLS: number }).todayCLS += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route(/\/api\/(?:tasks\/today|radar|objects)/, async (route) => {
    await new Promise((done) => setTimeout(done, 900));
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('.today-metric__skeleton').first()).toBeVisible();
  const before = await page.locator('.today-tabs').boundingBox();
  await expect(page.locator('.today-metric__skeleton')).toHaveCount(0);
  await expect(page.locator('.today-hints[aria-busy="true"]')).toHaveCount(0);
  const after = await page.locator('.today-tabs').boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  const cls = await page.evaluate(() => (window as unknown as { todayCLS: number }).todayCLS);
  process.stdout.write(`D20a CLS ${page.viewportSize()?.width}: ${cls.toFixed(4)}\n`);
  expect(cls).toBeLessThanOrEqual(0.1);
  await expect(page.getByText('Сроки пересчитываются.', { exact: false })).toHaveCount(0);
});
