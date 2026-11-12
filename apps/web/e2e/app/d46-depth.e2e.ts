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
import { homeDate } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs } from './notes-support.ts';
import { seedPerson } from './people-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

// D46 (UI-3, UI-10): светлое содержимое до краёв, тёмная шапка вплотную к верхней панели,
// без создания в шапках; две мягкие тени из токенов. Снимки «до» снимаются с D46_PHASE=before
// на старом коде: тогда проверки не выполняются.
const PHASE = process.env.D46_PHASE === 'before' ? 'before' : 'after';
const SHOTS = resolve(import.meta.dirname, '../../test-results/d46', PHASE);
const CHARCOAL = 'rgb(27, 26, 24)';
const DARK =
  '.topbar, .bottom-nav, .side-nav, .chrome, .page-heading, .sheet, .toast, [role="dialog"]';

/** Фон точки: первый непрозрачный фон вверх по дереву; тёмные области оболочки отмечены. */
async function probe(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y, dark }) => {
      let element = document.elementFromPoint(x, y);
      const chrome = element?.closest(dark) !== null && element?.closest(dark) !== undefined;
      while (element) {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return { color, chrome };
        element = element.parentElement;
      }
      return { color: getComputedStyle(document.body).backgroundColor, chrome };
    },
    { x, y, dark: DARK },
  );
}

async function expectBands(page: Page, label: string, darkHeader: boolean) {
  const box = await page.evaluate(() => {
    const content = document.querySelector('.app__content')?.getBoundingClientRect();
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    return {
      left: content?.left ?? 0,
      right: content?.right ?? window.innerWidth,
      top: topbar?.bottom ?? 0,
      height: window.innerHeight,
    };
  });
  // Светлая панель: по краям нет тёмного цвета шапки.
  const bands: string[] = [];
  for (const y of [0.55, 0.7].map((part) => Math.round(box.height * part))) {
    for (const x of [box.left + 1, box.right - 2]) {
      const point = await probe(page, x, y);
      if (!point.chrome && point.color === CHARCOAL) bands.push(`${label} x=${x} y=${y}`);
    }
  }
  expect(bands, 'тёмные полосы по краям светлой области').toEqual([]);
  if (darkHeader) {
    // Стык верхней панели и тёмной шапки — без светлой линии.
    for (const offset of [0.5, 2, 4]) {
      const point = await probe(page, Math.round((box.left + box.right) / 2), box.top + offset);
      expect(point.color, `${label}: стык шапки +${offset}px`).toBe(CHARCOAL);
    }
  }
}

async function expectNoHeaderCreate(page: Page, label: string) {
  const creates = await page
    .locator('.object-hero, .studio-list-hero, .feed-heading, .page-heading')
    .evaluateAll((nodes) =>
      nodes.flatMap((node) =>
        [...node.querySelectorAll('button, a')]
          .map((item) => item.getAttribute('aria-label') ?? item.textContent ?? '')
          .filter((name) => /^\s*Добавить|^\s*\+\s*$/.test(name)),
      ),
    );
  expect(creates, `${label}: создание в шапке`).toEqual([]);
}

/** Вычисленные тени: токены, группы, главная карточка и строки. */
async function shadows(page: Page) {
  return page.evaluate(() => {
    const probeShadow = (value: string) => {
      const element = document.createElement('div');
      element.style.boxShadow = value;
      document.body.append(element);
      const result = getComputedStyle(element).boxShadow;
      element.remove();
      return result;
    };
    const of = (selector: string) =>
      [...document.querySelectorAll(selector)]
        .filter((node) => node.getBoundingClientRect().width > 0)
        .map((node) => getComputedStyle(node).boxShadow);
    return {
      raised: probeShadow('var(--shadow-raised)'),
      float: probeShadow('var(--shadow-float)'),
      groups: of(
        '.studio-panel .row-list:not(.today-main .row-list), .ui6-service-page .ui6-panel > .section, .approved-card-fold, .approved-card-facts',
      ),
      focus: of('.today-main .swipe-task'),
      rows: of('.row, .task-row, .studio-panel li:not(.today-main .swipe-task, .tab-indicator)'),
      nav: of('.bottom-nav'),
      // Тень в покое: ближе её размера нет предка, который режет, и нет подложки другого
      // цвета: тень ложится только на фон страницы. Край экрана режет .main — это норма.
      spoiled: [
        ...document.querySelectorAll<HTMLElement>(
          '.studio-panel .row-list:not(.today-main .row-list), .plan-rows, .today-main .swipe-task, .shopping-page .task-list, .ui6-service-page .ui6-panel > .section, .approved-card-fold, .approved-card-facts',
        ),
      ]
        // Соседние ленты карусели в покое прозрачны и инертны: их тени не видны.
        .filter(
          (node) =>
            node.getBoundingClientRect().width > 0 && !node.closest('[data-feed-active="false"]'),
        )
        .flatMap((node) => {
          const box = node.getBoundingClientRect();
          const page = getComputedStyle(
            document.querySelector('.app') ?? document.body,
          ).backgroundColor;
          const issues: string[] = [];
          let parent = node.parentElement;
          while (parent && parent !== document.body) {
            const style = getComputedStyle(parent);
            const rect = parent.getBoundingClientRect();
            const name = `${node.className.split(' ')[0]} < ${parent.tagName}.${String(parent.className).split(' ')[0]}`;
            const clips = /hidden|clip/.test(`${style.overflowX} ${style.overflowY}`);
            const edge = rect.width >= window.innerWidth - 1;
            // overflow-clip-margin отодвигает край обрезки только при overflow: clip.
            const margin =
              style.overflowX === 'clip' && style.overflowY === 'clip'
                ? Number.parseFloat(style.getPropertyValue('overflow-clip-margin')) || 0
                : 0;
            const near =
              box.left - rect.left + margin < 40 ||
              rect.right - box.right + margin < 40 ||
              rect.bottom - box.bottom + margin < 40;
            if (clips && !edge && near)
              issues.push(`${name}: обрезка ${style.overflow}, поле ${margin}px`);
            const color = style.backgroundColor;
            if (color !== 'rgba(0, 0, 0, 0)' && color !== page)
              issues.push(`${name}: подложка ${color}`);
            if (parent.classList.contains('studio-panel')) break;
            parent = parent.parentElement;
          }
          return issues;
        }),
      sheet: of('.sheet'),
    };
  });
}

test('D46: полосы, шапки без создания и мягкие тени', async ({ page, family }, info) => {
  test.skip(info.project.name !== 'w360', 'Матрица ширин выполняется один раз.');
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, {
    title: 'Апартаменты Питер',
    audience: 'household',
  });
  await seedMeter(api, property.id, {
    title: 'Холодная вода',
    data: { resource: 'cold_water', serialNumber: 'TEST-D46' },
    initial: { occurredOn: '2026-07-20', values: ['124.600'] },
  });
  const mainTask = await api.post('tasks', {
    title: 'Полить цветы на балконе',
    planOn: homeDate(0),
  });
  expect(mainTask.status).toBe(201);
  const mainTaskId = (mainTask.body as { id: string }).id;
  expect((await api.post(`tasks/${mainTaskId}/main`, { selected: true })).status).toBe(200);
  expect(
    (await api.post('tasks', { title: 'Проверить счётчики воды', planOn: homeDate(0) })).status,
  ).toBe(201);
  await seedPerson(api, { title: 'Ольга Солнечная', placement: { spaceId: family.houseId } });
  const contract = await seedDocument(api, {
    title: 'Договор аренды',
    type: 'contract',
    expiresOn: homeDate(20),
    placement: { spaceId: family.houseId },
  });
  await signInAs(page, family, 'adult');

  const screens = [
    { name: 'today', route: '/today', heading: /Добрый|Сегодня/, dark: true },
    { name: 'all', route: '/today/all', heading: 'Все дела', dark: true },
    { name: 'plan', route: '/today/plan', heading: 'План', dark: true },
    { name: 'shopping', route: '/more/shopping', heading: 'Покупки', dark: true },
    { name: 'people', route: '/people', heading: 'Люди', dark: true },
    { name: 'object', route: `/home/${property.id}`, heading: property.title, dark: true },
    { name: 'document', route: `/documents/${contract.id}`, heading: contract.title, dark: true },
    { name: 'home', route: '/home', heading: 'Дом', dark: true },
    { name: 'settings', route: '/more/settings', heading: 'Настройки', dark: true },
    { name: 'sheet', route: `/home/${property.id}`, heading: property.title, dark: true },
  ] as const;
  const failures: string[] = [];
  for (const width of [360, 412, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    for (const screen of screens) {
      const label = `${screen.name}-${width}`;
      await page.goto('#/more');
      await page.goto(`#${screen.route}`);
      await expect(
        page.getByRole('heading', { level: 1, name: screen.heading }).first(),
      ).toBeVisible();
      await expect(page.getByText(/Загружаем/)).toHaveCount(0);
      await settle(page);
      if (screen.name === 'sheet') {
        await page.getByRole('button', { name: /^Ещё: действия/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
      }
      await page.screenshot({ path: resolve(SHOTS, `${label}.png`), fullPage: width !== 1440 });
      if (PHASE === 'before') continue;
      try {
        await page.evaluate(() => window.scrollTo(0, 0));
        if (screen.name !== 'sheet') {
          await expectBands(page, label, screen.dark);
          await expectNoHeaderCreate(page, label);
        }
        const value = await shadows(page);
        expect(value.raised).not.toBe('none');
        expect(value.float).not.toBe('none');
        for (const group of value.groups) expect(group, `${label}: группа`).toBe(value.raised);
        for (const focus of value.focus) expect(focus, `${label}: главное дело`).toBe(value.raised);
        for (const row of value.rows) expect(row, `${label}: строка`).toBe('none');
        expect(value.spoiled, `${label}: тень обрезана или на подложке`).toEqual([]);
        if (width < 960) for (const nav of value.nav) expect(nav).toBe(value.float);
        if (screen.name === 'sheet') expect(value.sheet).toContain(value.float);
        if (screen.name === 'home' || screen.name === 'settings')
          expect(value.groups.length, `${label}: группы найдены`).toBeGreaterThan(0);
        if (screen.name === 'today') expect(value.focus.length).toBe(1);
        if (width < 960) {
          await expectNoHorizontalScroll(page);
          if (screen.name !== 'sheet') await expectTouchTargets(page);
          await expectAccessible(page, label);
        }
      } catch (error) {
        failures.push(`${label}: ${String(error)}`);
        console.log(`D46 FAIL ${label}: ${String(error).slice(0, 600)}`);
      }
    }
  }
  // Рамка фокуса первой и последней строки групп видна целиком: её не режут ни группа со
  // скруглением, ни обёртки строк, ни лента.
  if (PHASE === 'after') {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('#/more/shopping');
    await page.getByLabel('Добавить одной строкой').fill('Молоко');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('link', { name: /^Молоко/ })).toBeVisible();
    await page.getByLabel('Добавить одной строкой').fill('Хлеб');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('link', { name: /^Хлеб/ })).toBeVisible();
    const cut: string[] = [];
    for (const [name, route, group] of [
      ['today', '/today', '.studio-panel .row-list'],
      ['plan', '/today/plan', '.plan-rows, .studio-panel .row-list'],
      ['shopping', '/more/shopping', '.shopping-page .task-list'],
    ] as const) {
      await page.goto('#/more');
      await page.goto(`#${route}`);
      await expect(
        page
          .locator('[data-feed-active="true"]')
          .getByText(name === 'shopping' ? 'Хлеб' : 'Полить цветы на балконе')
          .first(),
      ).toBeVisible();
      await expect(page.getByText(/Загружаем/)).toHaveCount(0);
      await settle(page);
      const text = name === 'shopping' ? 'Хлеб' : 'Полить цветы на балконе';
      const targets = await page.evaluate(
        ({ selector, text }) => {
          // Группа строк — список, в котором стоит видимая строка с этим названием.
          const row = [...document.querySelectorAll('li')].find(
            (item) =>
              item.getBoundingClientRect().width > 0 &&
              !item.closest('[data-feed-active="false"]') &&
              item.textContent?.includes(text),
          );
          const list = row?.parentElement ?? document.querySelector(selector);
          const items = list ? [...list.children] : [];
          return [items[0], items.at(-1)].flatMap((item, at) =>
            [...(item?.querySelectorAll('a[href], button') ?? [])]
              .filter((node) => node.getBoundingClientRect().width > 0)
              .map((node, index) => {
                node.setAttribute('data-d46-focus', `${at}-${index}`);
                return `${at}-${index}`;
              }),
          );
        },
        { selector: group, text },
      );
      expect(targets.length, `${name}: строки найдены`).toBeGreaterThan(0);
      for (const id of targets) {
        await page.keyboard.press('Shift');
        await page.locator(`[data-d46-focus="${id}"]`).focus();
        const problem = await page.evaluate((key) => {
          const node = document.querySelector<HTMLElement>(`[data-d46-focus="${key}"]`);
          if (!node?.matches(':focus-visible')) return `${key}: нет :focus-visible`;
          const style = getComputedStyle(node);
          const grow = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const box = node.getBoundingClientRect();
          const ring = {
            left: box.left - grow,
            top: box.top - grow,
            right: box.right + grow,
            bottom: box.bottom + grow,
          };
          const radius = parseFloat(style.borderTopLeftRadius) || 0;
          let parent = node.parentElement;
          while (parent && !parent.classList.contains('studio-panel')) {
            const own = getComputedStyle(parent);
            if (/hidden|clip/.test(`${own.overflowX} ${own.overflowY}`)) {
              const rect = parent.getBoundingClientRect();
              if (
                ring.left < rect.left - 0.5 ||
                ring.right > rect.right + 0.5 ||
                ring.top < rect.top - 0.5 ||
                ring.bottom > rect.bottom + 0.5
              )
                return `${key}: рамка выходит за ${parent.className}`;
              // Угол рамки (с её скруглением) лежит внутри скруглённого угла предка.
              const corner = parseFloat(own.borderTopLeftRadius) || 0;
              const inset = Math.max(0, radius + grow) * (1 - Math.SQRT1_2);
              for (const [x, y, cx, cy] of [
                [ring.left + inset, ring.top + inset, rect.left + corner, rect.top + corner],
                [ring.right - inset, ring.top + inset, rect.right - corner, rect.top + corner],
                [ring.left + inset, ring.bottom - inset, rect.left + corner, rect.bottom - corner],
                [
                  ring.right - inset,
                  ring.bottom - inset,
                  rect.right - corner,
                  rect.bottom - corner,
                ],
              ] as const) {
                const inCorner =
                  Math.abs(x - cx) <= corner &&
                  Math.abs(y - cy) <= corner &&
                  (x - cx) * (cx - (rect.left + rect.right) / 2) > 0 &&
                  (y - cy) * (cy - (rect.top + rect.bottom) / 2) > 0;
                if (corner > 0 && inCorner && Math.hypot(x - cx, y - cy) > corner + 0.5)
                  return `${key}: скругление ${parent.className} режет угол рамки`;
              }
            }
            parent = parent.parentElement;
          }
          return null;
        }, id);
        if (problem) {
          cut.push(`${name} ${problem}`);
          console.log(`D46 CUT ${name} ${problem}`);
        }
      }
      await page.keyboard.press('Shift');
      await page.locator('[data-d46-focus="0-0"]').focus();
      await page.screenshot({ path: resolve(SHOTS, `focus-${name}-360.png`) });
    }
    expect(cut, 'рамка фокуса обрезана').toEqual([]);
  }
  // Возврат назад и прокрутка: стык карточки объекта остаётся тёмным.
  if (PHASE === 'after') {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('#/home');
    await page
      .getByRole('link', { name: new RegExp(property.title) })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: property.title })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: property.title })).toBeVisible();
    await settle(page);
    await expectBands(page, 'object-back', true);
  }
  expect(failures).toEqual([]);
});
