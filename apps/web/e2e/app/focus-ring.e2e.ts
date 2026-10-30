import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { type DateOnly, formatLongDate, weekdayName } from '../../src/ui/format.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { signInAs } from './support.ts';

// D36: кольцо фокуса — одно спокойное кольцо для клавиатуры, без кольца после касания.
// Проекты w360 и w412 уже эмулируют телефон: isMobile и hasTouch (playwright.config.ts).

const RING_LIGHT = 'rgb(181, 83, 45)'; // --focus-ring #b5532d
const RING_DARK = 'rgb(236, 138, 98)'; // --accent-on-dark #ec8a62
const ACTIVE_HEADING = '.feed-heading__variant[data-feed-heading-active="true"]';

async function ring(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      offset: Number.parseFloat(style.outlineOffset),
      color: style.outlineColor,
      shadow: style.boxShadow,
    };
  });
}

/** Нет видимого кольца: контур выключен (или нулевой) и нет тени-кольца. */
async function expectNoRing(locator: Locator) {
  const value = await ring(locator);
  expect(value.style === 'none' || value.width === 0, JSON.stringify(value)).toBe(true);
  expect(value.shadow).toBe('none');
}

async function shot(page: Page, info: TestInfo, name: string) {
  const directory = resolve(import.meta.dirname, '../../test-results/screens/D36');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${info.project.name}.png`) });
}

/** Настоящий жест пальцем через CDP: touch → pointer events и touch-action браузера. */
async function touchSwipe(page: Page, dx: number) {
  const target = page.locator('.feed-heading');
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing gesture target');
  const width = page.viewportSize()?.width ?? 360;
  const x = dx < 0 ? width - 35 : 35;
  const y = box.y + Math.min(24, box.height / 2);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 6, y }],
      });
      await page.waitForTimeout(25);
    }
    // Палец замирает перед отпусканием: без инерции следующее касание — обычный тап,
    // а не остановка прокрутки (Chromium такой тап в click не превращает).
    await page.waitForTimeout(150);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test('D36: касание и свайп не рисуют кольцо, клавиатура — одно кольцо', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await expect(page.locator('[data-feed-ready="true"]')).toHaveCount(4);
  const active = page.locator('.today-tabs [aria-current="page"]');

  // Касание вкладки — без кольца.
  await page.locator('.today-tabs').getByRole('link', { name: 'План', exact: true }).tap();
  await expect(page.locator('.feed-carousel')).toHaveAttribute('data-feed-index', '1');
  await settle(page);
  await expectNoRing(active);
  await expectNoRing(page.locator(':focus'));

  // Свайп переводит фокус на вкладку (для диктора), но без кольца.
  for (let index = 2; index < 4; index++) {
    await touchSwipe(page, -150);
    await expect(page.locator('.feed-carousel')).toHaveAttribute('data-feed-index', String(index));
    await settle(page);
    await expect(active).toBeFocused();
    await expectNoRing(active);
  }
  await shot(page, info, 'swipe-touch');

  // Поле «Что купить?»: только своя рамка 2 px цвета акцента, внешнего кольца нет.
  const input = page.getByPlaceholder('Что купить?');
  await input.tap();
  await expect(input).toBeFocused();
  const field = await ring(input);
  expect(field.shadow).toBe('none');
  expect(field.offset).toBeLessThanOrEqual(0);
  expect(field.width).toBeLessThanOrEqual(2);
  expect(field.color).toBe(RING_LIGHT);
  await shot(page, info, 'input-touch');
  await expectAccessible(page, 'D36-input-touch');

  // Клавиатура на светлой поверхности: одно кольцо 2 px, без второй тени. Полоса вкладок
  // прокручивается и обрезала бы внешний контур, поэтому у вкладок кольцо внутри (−2 px).
  const links = page.locator('.today-tabs .tabs__link');
  await links.nth(0).focus();
  await page.keyboard.press('Tab');
  await expect(links.nth(1)).toBeFocused();
  const light = await ring(links.nth(1));
  expect(light).toMatchObject({ style: 'solid', width: 2, offset: -2, color: RING_LIGHT });
  expect(light.shadow).toBe('none');

  // Клавиатура после свайпа снова показывает кольцо.
  await page.keyboard.press('Shift+Tab');
  await expect(links.nth(0)).toBeFocused();
  expect(await ring(links.nth(0))).toMatchObject({ style: 'solid', width: 2 });
  await shot(page, info, 'tab-light');

  // Тёмная нижняя панель: светлое кольцо из переменной контейнера.
  const nav = page.locator('.bottom-nav a');
  await nav.nth(0).focus();
  await page.keyboard.press('Tab');
  await expect(nav.nth(1)).toBeFocused();
  const dark = await ring(nav.nth(1));
  expect(dark).toMatchObject({ style: 'solid', width: 2, offset: 2, color: RING_DARK });
  expect(dark.shadow).toBe('none');
  await shot(page, info, 'tab-dark');
  await expectAccessible(page, 'D36-tab');
});

test('D36: дата и приветствие «Сегодня» — в общей шапке, высота шапок равна', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  await signInAs(page, family, 'adult');
  await expect(page.locator('[data-feed-ready="true"]')).toHaveCount(4);
  const today = homeDate(0) as DateOnly;
  const heading = page.locator(ACTIVE_HEADING);
  await expect(heading.locator('.page-heading__eyebrow')).toHaveText(
    `${weekdayName(today)}, ${formatLongDate(today)}`,
  );
  await expect(heading.locator('.feed-heading__greeting')).toHaveText(/^Добрый день, .+/);
  await expect(heading.locator('.feed-heading__summary')).toContainText('Сегодня:');
  // Внизу ленты — только показатели и подсказки.
  const overview = page.locator('.feed-overview');
  await expect(overview.getByRole('navigation', { name: 'Показатели на сегодня' })).toBeVisible();
  await expect(overview).not.toContainText('Добрый день');
  await expect(overview).not.toContainText(formatLongDate(today));
  await settle(page);
  await shot(page, info, 'today-heading');

  for (const scale of ['100%', '200%']) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, scale);
    const heights: number[] = [];
    const tabs: number[] = [];
    for (const label of ['План', 'Все дела', 'Покупки', 'Сегодня']) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.today-tabs').getByRole('link', { name: label, exact: true }).tap();
      await settle(page);
      await expect(heading.locator('.feed-heading__summary')).toContainText(`${label}:`);
      heights.push((await page.locator('.feed-heading').boundingBox())?.height ?? 0);
      tabs.push((await page.locator('.today-tabs').boundingBox())?.y ?? 0);
      if (label !== 'Сегодня')
        await expect(heading.locator('.feed-heading__greeting')).toHaveCount(0);
    }
    for (const value of heights) expect(Math.abs(value - (heights[0] ?? 0))).toBeLessThanOrEqual(1);
    for (const value of tabs) expect(Math.abs(value - (tabs[0] ?? 0))).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    if (scale === '200%') await shot(page, info, 'today-heading-200');
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await expectTouchTargets(page);
  await expectAccessible(page, 'D36-today-heading');
});
