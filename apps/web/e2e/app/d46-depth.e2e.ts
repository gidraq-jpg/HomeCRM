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
        '.studio-panel .row-list, .ui6-service-page .ui6-panel > .section, .approved-card-fold, .approved-card-facts',
      ),
      focus: of('.studio-panel .task-focus'),
      rows: of('.row, .task-row, .studio-panel li'),
      nav: of('.bottom-nav'),
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
  for (const title of ['Полить цветы на балконе', 'Проверить счётчики воды']) {
    expect((await api.post('tasks', { title, planOn: homeDate(0) })).status).toBe(201);
  }
  await seedPerson(api, { title: 'Ольга Солнечная', placement: { spaceId: family.houseId } });
  const document = await seedDocument(api, {
    title: 'Договор аренды',
    type: 'contract',
    expiresOn: homeDate(20),
    placement: { spaceId: family.houseId },
  });
  await signInAs(page, family, 'adult');

  const screens = [
    { name: 'today', route: '/today', heading: /Добрый|Сегодня/, dark: true },
    { name: 'all', route: '/today/all', heading: 'Все дела', dark: true },
    { name: 'people', route: '/people', heading: 'Люди', dark: true },
    { name: 'object', route: `/home/${property.id}`, heading: property.title, dark: true },
    { name: 'document', route: `/documents/${document.id}`, heading: document.title, dark: true },
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
        for (const focus of value.focus) expect(focus, `${label}: главное дело`).toBe(value.float);
        for (const row of value.rows) expect(row, `${label}: строка`).toBe('none');
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
