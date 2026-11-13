import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { homeDate, recalc } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { signInAs } from './support.ts';

test('Тёмные шапки и кнопки действий: контраст, геометрия, текст 200%', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Полная матрица ширин выполняется один раз.');
  test.setTimeout(300_000);
  const api = await apiAs(family, 'adult');
  for (const title of ['Подготовить квартиру к зиме', 'Обновить документы']) {
    expect((await api.post('tasks', { title, planOn: homeDate(0) })).status).toBe(201);
  }
  const note = await seedNote(api, family, {
    title: 'План домашних дел',
    body: 'Проверить запасы и полить цветы.',
  });
  // В fixture нет фонового worker: выполняем его настоящий пересчёт перед съёмкой.
  await recalc(family);
  await signInAs(page, family, 'adult');
  const rootTokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ['--studio-group-radius', '--studio-field-radius', '--gutter', '--nav-height'].map((name) => [
        name,
        style.getPropertyValue(name).trim(),
      ]),
    );
  });
  expect(rootTokens).toEqual({
    '--studio-group-radius': '16px',
    '--studio-field-radius': '12px',
    '--gutter': '20px',
    '--nav-height': '76px',
  });
  const failures: string[] = [];
  const routes = [
    ['today', '/today', 'Сегодня'],
    ['plan', '/today/plan', 'План'],
    ['tasks', '/today/all', 'Все дела'],
    ['shopping', '/more/shopping', 'Покупки'],
    ['notes', '/more/notes', 'Заметки'],
    ['card', `/more/notes/${note.id}`, 'План домашних дел'],
    ['form', '/more/notes/new', 'Новая заметка'],
    ['settings', '/more/settings', 'Настройки'],
  ] as const;
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: width === 360 ? 740 : width === 529 ? 1252 : 915 });
    for (const percent of [100, 200]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, percent);
      for (const [name, route, heading] of routes) {
        await page.goto(`#${route}`);
        await expect(
          page.getByRole('heading', { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        if (['today', 'plan', 'tasks', 'shopping'].includes(name)) {
          await expect(page.locator('[data-feed-ready="true"]')).toHaveCount(4);
          await expect(
            page.locator('[data-feed-heading-active="true"] .feed-heading__summary'),
          ).toContainText(heading === 'Сегодня' ? 'Сегодня ·' : `${heading}:`);
        }
        // Проверяем и подзапросы карточки: её h1 приходит раньше связей и файлов.
        await expect(page.getByRole('status', { name: /^Загружаем/ })).toHaveCount(0);
        await expect(page.getByText(/Загружаем/)).toHaveCount(0);
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: info.outputPath(`${name}-${width}-${percent}.png`),
          fullPage: true,
        });
        try {
          const geometry = await page
            .locator('button:not(.fab, .today-main .focus__actions .btn), a.icon-button')
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => node.getBoundingClientRect().width > 0)
                .map((node) => ({
                  name: node.getAttribute('aria-label') ?? node.textContent,
                  radius: parseFloat(getComputedStyle(node).borderTopLeftRadius),
                })),
            );
          expect(
            geometry.filter((button) => button.radius > 14),
            'действия без круглой или pill-формы',
          ).toEqual([]);
          const headers = await page
            .locator(
              '.feed-heading, .page-heading .studio-list-hero, .object-hero, .ui7-form-heading',
            )
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => node.getBoundingClientRect().width > 0)
                .map((node) => ({
                  background: getComputedStyle(node).backgroundColor,
                  foreground: getComputedStyle(node).color,
                })),
            );
          expect(headers.length).toBeGreaterThan(0);
          for (const header of headers) {
            expect(header.background).toBe('rgb(27, 26, 24)');
            expect(header.foreground).toBe('rgb(238, 233, 223)');
          }
          const overdue = page.locator(
            '[data-feed-active="true"] .all-tasks-overdue .today-overdue',
          );
          if (name === 'tasks' && (await overdue.count())) {
            await expect(overdue).toHaveCSS('background-color', 'rgb(246, 220, 220)');
            await expect(overdue).toHaveCSS('color', 'rgb(140, 29, 43)');
          }
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await expectAccessible(page, `${name}-${width}-${percent}`);
          const overflow = await page
            .locator('.visibility__label')
            .evaluateAll((labels) =>
              labels
                .filter((label) => label.scrollWidth > label.clientWidth)
                .map((label) => label.textContent),
            );
          expect(overflow, 'подписи аудитории остаются внутри своих целей').toEqual([]);
          const boundaries = await page
            .locator(
              '.tab-indicator:not(.today-tabs .tab-indicator), .studio-segments > button[aria-pressed="true"]',
            )
            .evaluateAll((nodes) => {
              const luminance = (color: string) => {
                const rgb = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
                  const channel = Number(value) / 255;
                  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
              };
              return nodes.flatMap((node) => {
                const style = getComputedStyle(node);
                const border = luminance(style.borderTopColor);
                const surfaces = [
                  style.backgroundColor,
                  getComputedStyle(node.parentElement ?? node).backgroundColor,
                ];
                return surfaces.map((color) => {
                  const surface = luminance(color);
                  return (Math.max(border, surface) + 0.05) / (Math.min(border, surface) + 0.05);
                });
              });
            });
          for (const contrast of boundaries)
            expect(contrast, 'граница выбранного сегмента ≥ 3:1').toBeGreaterThanOrEqual(3);
        } catch (error) {
          failures.push(`${name}-${width}-${percent}: ${String(error)}`);
        }
        if (name === 'today') {
          const tabs = page.getByRole('navigation', { name: 'Ленты дел' });
          await expect(tabs.locator('.tab-indicator')).toHaveCSS('border-top-width', '0px');
          await expect(tabs.locator('.tab-indicator')).toHaveCSS(
            'background-color',
            'rgb(248, 245, 239)',
          );
          const active = await tabs.locator('[aria-current="page"]').boundingBox();
          const indicator = await tabs.locator('.tab-indicator').boundingBox();
          expect(indicator?.height).toBeCloseTo(active?.height ?? 0, 0);
          expect(indicator?.width).toBeCloseTo(active?.width ?? 0, 0);
          expect(indicator?.x).toBeCloseTo(active?.x ?? 0, 0);
        }
      }
    }
  }
  expect(failures).toEqual([]);
});
