import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate } from './deadlines-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

// D47 (UI-11): темы «Монохром» и «iOS» на «Сегодня», «Доме», карточке объекта и в настройках.
// Выбор делается в настройках, как у человека; снимки лежат в test-results/d47.
const SHOTS = resolve(import.meta.dirname, '../../test-results/d47');

const THEMES = [
  { id: 'mono', label: 'Монохром', background: 'rgb(255, 255, 255)' },
  { id: 'ios', label: 'iOS', background: 'rgb(242, 242, 247)' },
] as const;

test('D47: темы на четырёх экранах, 360 px, axe и без горизонтальной прокрутки', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Темы проверяются на 360 px.');
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, {
    title: 'Апартаменты Питер',
    audience: 'household',
  });
  await seedMeter(api, property.id, {
    title: 'Холодная вода',
    data: { resource: 'cold_water', serialNumber: 'TEST-D47' },
    initial: { occurredOn: homeDate(-3), values: ['124.600'] },
  });
  for (const title of ['Полить цветы на балконе', 'Проверить счётчики воды']) {
    expect((await api.post('tasks', { title, planOn: homeDate(0) })).status).toBe(201);
  }
  await signInAs(page, family, 'adult');

  // По умолчанию — Studio: атрибут темы не окрашивает страницу.
  await page.goto('#/more/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Studio/ })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'studio');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#20201e');

  const failures: string[] = [];
  for (const theme of THEMES) {
    await page.goto('#/more/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await page.getByRole('radio', { name: new RegExp(theme.label) }).check({ force: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    // Цвет сменился сразу, без перезагрузки.
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.querySelector('.app') ?? document.body).backgroundColor,
        ),
      )
      .toBe(theme.background);
    // Выбор переживает перезагрузку (хранится на устройстве).
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);

    const screens = [
      { name: 'today', route: '/today', heading: /Добрый|Сегодня/ },
      { name: 'home', route: '/home', heading: 'Дом' },
      { name: 'object', route: `/home/${property.id}`, heading: property.title },
      { name: 'settings', route: '/more/settings', heading: 'Настройки' },
    ] as const;
    for (const screen of screens) {
      const label = `${theme.id}-${screen.name}`;
      await page.goto('#/more');
      await page.goto(`#${screen.route}`);
      await expect(
        page.getByRole('heading', { level: 1, name: screen.heading }).first(),
      ).toBeVisible();
      await expect(page.getByText(/Загружаем/)).toHaveCount(0);
      await settle(page);
      if (screen.name === 'today') {
        // Активный раздел меню и выбранная вкладка видны: фон плашки не равен фону меню,
        // контраст подписи не ниже 4,5:1.
        const nav = await page.evaluate(() => {
          const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const light = (value: string) => {
            const [r = 0, g = 0, b = 0] = parse(value).map((part) => {
              const unit = part / 255;
              return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const ratio = (a: string, b: string) => {
            const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
            return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
          };
          const pair = (indicator: string, link: string, menu: string) => {
            const mark = document.querySelector(indicator);
            const text = document.querySelector(link);
            const base = document.querySelector(menu);
            if (!mark || !text || !base) return null;
            const fill = getComputedStyle(mark).backgroundColor;
            return {
              fill,
              menu: getComputedStyle(base).backgroundColor,
              contrast: ratio(getComputedStyle(text).color, fill),
            };
          };
          return {
            section: pair(
              '.bottom-nav .section-indicator',
              '.bottom-nav__link[aria-current="page"]',
              '.bottom-nav',
            ),
            tab: pair('.tabs .tab-indicator', '.tabs__link[aria-current="page"]', '.tabs__list'),
          };
        });
        expect(nav.section, `${label}: плашка раздела найдена`).not.toBeNull();
        expect(nav.section?.fill, `${label}: плашка раздела`).not.toBe(nav.section?.menu);
        expect(nav.section?.contrast ?? 0, `${label}: подпись раздела`).toBeGreaterThanOrEqual(4.5);
        expect(nav.tab?.fill, `${label}: плашка вкладки`).not.toBe(nav.tab?.menu);
        expect(nav.tab?.contrast ?? 0, `${label}: подпись вкладки`).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({ path: resolve(SHOTS, `${label}-360.png`), fullPage: true });
      try {
        await expectNoHorizontalScroll(page);
        await expectAccessible(page, label);
      } catch (error) {
        failures.push(`${label}: ${String(error)}`);
        console.log(`D47 FAIL ${label}: ${String(error).slice(0, 900)}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
