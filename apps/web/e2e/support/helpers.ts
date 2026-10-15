import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures.ts';

/** Скриншоты экранов: test-results/screens/<ширина>/NN-название.png. В git они не попадают. */
export const SCREENSHOT_DIR = resolve(import.meta.dirname, '../../test-results/screens');

/** Минимальная цель нажатия, px (PRD, раздел 13). */
export const MIN_TARGET = 44;

const NBSP = String.fromCodePoint(0xa0);

/** Текст без неразрывных пробелов: так проверять суммы и даты проще. */
export function plain(text: string): string {
  return text.replaceAll(NBSP, ' ').replace(/\s+/g, ' ').trim();
}

export async function openApp(page: Page, route = '/today'): Promise<void> {
  await page.goto(`#${route}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export function widthOf(testInfo: TestInfo): number {
  return testInfo.project.use.viewport?.width ?? 0;
}

/** Нет горизонтальной прокрутки страницы — на 360 px это требование PRD. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await settle(page);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(overflow.scrollWidth, 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Все видимые нажимаемые элементы не меньше 44×44 px. `root` — например, открытая панель. */
export async function expectTouchTargets(page: Page, root = 'body'): Promise<void> {
  const small = await page.evaluate(
    ({ selector, min }) => {
      const result: { element: string; width: number; height: number }[] = [];
      const candidates = document.querySelectorAll(
        `${selector} :is(a[href], button, input:not([type="hidden"]), select, textarea, summary)`,
      );
      for (const element of candidates) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue;
        if (element.closest('[aria-hidden="true"], [hidden]')) continue;
        if (rect.width < min - 0.5 || rect.height < min - 0.5) {
          const label =
            element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '';
          result.push({
            element: `${element.tagName.toLowerCase()} «${label}»`,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
      return result;
    },
    { selector: root, min: MIN_TARGET },
  );
  expect(small, `цели нажатия меньше ${MIN_TARGET} px`).toEqual([]);
}

/** axe: серьёзных и критичных замечаний нет; остальные печатаются, чтобы их было видно. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  await settle(page);
  // Одинаковая начальная позиция снимка: липкая шапка не обрезает цели в середине прокрутки.
  await page.evaluate(() => window.scrollTo(0, 0));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();

  const describe = (violation: (typeof results.violations)[number]) =>
    `${violation.impact}: ${violation.id} — ${violation.help} (${violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(' '))
      .join('; ')})`;

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const minor = results.violations.filter((violation) => !blocking.includes(violation));
  if (minor.length > 0) {
    console.log(`[axe] ${label}: замечания без блокировки\n  ${minor.map(describe).join('\n  ')}`);
  }
  expect(blocking.map(describe), `axe: серьёзные и критичные замечания, ${label}`).toEqual([]);
}

/**
 * Скриншот в test-results/screens/<ширина>/<название>.png.
 * `page` — вся страница: окно браузера растягивается до высоты страницы, чтобы нижнее меню
 * и кнопка «+» стояли внизу, как у человека, который долистал до конца. `viewport` — то, что
 * видно на экране телефона без прокрутки; так снимаются панели.
 */
export async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  mode: 'page' | 'viewport' = 'page',
): Promise<void> {
  const dir = resolve(SCREENSHOT_DIR, String(widthOf(testInfo)));
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name}.png`);

  const viewport = page.viewportSize();
  if (mode === 'viewport' || viewport === null) {
    await page.screenshot({ path });
    return;
  }
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width: viewport.width, height: Math.max(height, viewport.height) });
  try {
    await page.screenshot({ path });
  } finally {
    await page.setViewportSize(viewport);
  }
}

interface CheckOptions {
  /** Корень для проверки целей нажатия, например открытая панель. */
  targetsRoot?: string;
  /** Без скриншота: для повторных проверок одного и того же экрана. */
  noShot?: boolean;
  /** Что снимать: всю страницу (по умолчанию) или только видимую часть, например с панелью. */
  shot?: 'page' | 'viewport';
}

/** Ждёт конца анимаций: пока панель выезжает и проявляется, цвета смешаны и контраст не тот. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
  });
}

/** Всё, что проверяется на каждом экране: прокрутка, цели нажатия, axe и скриншот. */
export async function checkScreen(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: CheckOptions = {},
): Promise<void> {
  await settle(page);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page, options.targetsRoot);
  await expectAccessible(page, `${name} (${widthOf(testInfo)} px)`);
  if (!options.noShot) await screenshot(page, testInfo, name, options.shot);
}

/** Переключатель «Всё · Общее · Личное» в шапке. */
export async function setScope(page: Page, label: 'Всё' | 'Общее' | 'Личное'): Promise<void> {
  const trigger = page.getByRole('button', { name: /^Пространство:/ });
  const inSheet = (await trigger.count()) > 0;
  if (inSheet) await trigger.click();
  await page.getByRole('radio', { name: label, exact: true }).check();
  if (inSheet)
    await page
      .getByRole('dialog', { name: 'Пространство', exact: true })
      .getByRole('button', { name: 'Закрыть', exact: true })
      .click();
}

/** Нижнее меню: перейти в раздел. */
export async function goToSection(page: Page, label: string): Promise<void> {
  const link = page
    .getByRole('navigation', { name: 'Основные разделы' })
    .getByRole('link', { name: label });
  await link.click();
  // Маршрут и содержимое меняются в одном проходе: пока раздел не отмечен, экран ещё старый.
  await expect(link).toHaveAttribute('aria-current', 'page');
}

/** «+» → вид записи. Открывает панель добавления на форме нужного вида. */
export async function startAdd(page: Page, kind: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: new RegExp(`^${kind}`) }).click();
}

/** Быстрое дело в листе Studio 2. */
export async function openQuick(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Добавить', exact: true })
    .getByRole('button', { name: /^Дело/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Новое дело', exact: true })).toBeVisible();
}

export async function openObjectActions(page: Page): Promise<void> {
  if (/^#\/home\/[a-f0-9-]+(?:\/|$)/.test(new URL(page.url()).hash))
    await expect(page.getByRole('button', { name: 'Ещё: действия с объектом' })).toBeVisible();
  if (
    (await page.locator('.object-page').count()) &&
    !(await page.getByRole('dialog', { name: 'Ещё', exact: true }).count())
  )
    await page.getByRole('button', { name: 'Ещё: действия с объектом' }).click();
}
export async function openObjectAccess(page: Page): Promise<void> {
  if ((await page.locator('.object-page').count()) && !(await page.getByRole('dialog').count()))
    await page.getByRole('button', { name: 'Кто видит объект', exact: true }).click();
}

export async function openObjectDetails(page: Page): Promise<void> {
  const summary = page.getByText('Об объекте и свои поля', { exact: true });
  const unavailable = page.getByText('Объекта больше нет, или он стал вам недоступен', {
    exact: false,
  });
  await expect(summary.or(unavailable)).toBeVisible();
  if ((await summary.count()) && (await summary.locator('..').getAttribute('open')) === null)
    await summary.click();
}
