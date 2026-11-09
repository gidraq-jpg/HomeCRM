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
