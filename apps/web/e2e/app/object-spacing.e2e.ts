import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openObjectDetails,
  SCREENSHOT_DIR,
  screenshot,
} from '../support/helpers.ts';
import { apiAs, seedObject } from './notes-support.ts';
import { signInAs } from './support.ts';

for (const percent of [100, 200]) {
  test(`Studio 2: факты и поля не сдвигаются при загрузке дел, текст ${percent}%`, async ({
    page,
    family,
  }, info) => {
    const api = await apiAs(family, 'adult');
    const object = await seedObject(api, family, {
      title: 'Квартира у парка',
      objectType: 'property',
      audience: 'household',
      fields: [{ name: 'Площадь', value: '54 м²' }],
    });
    await signInAs(page, family, 'adult');
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}%`;
    }, percent);
    const fallback = await page.addStyleTag({
      content: ':root { --font-sans: Arial, sans-serif !important; }',
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/tasks?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('objectId') !== object.id)
        return route.continue();
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    const lastFact = page.locator('dl.facts').first().locator('.facts__item').last();
    const title = page.getByRole('heading', { level: 2, name: 'Свои поля' });
    // Оба прямоугольника в одном кадре: шрифт или прокрутка не подменяют реальный отступ.
    const gap = () =>
      page.evaluate(() => {
        const fact = document
          .querySelector('dl.facts .facts__item:last-child')
          ?.getBoundingClientRect();
        const heading = document
          .querySelector('.object-details .section__title')
          ?.getBoundingClientRect();
        if (!fact || !heading) throw new Error('Не найдены факты или заголовок полей');
        return heading.top - fact.bottom;
      });
    try {
      await page.goto(`#/home/${object.id}`);
      await openObjectDetails(page);
      await expect(page.getByText('Загружаем дела…', { exact: true })).toBeVisible();
      expect(await gap(), 'отступ с запасным шрифтом').toBeGreaterThanOrEqual(16);
      await fallback.evaluate((style) => style.parentNode?.removeChild(style));
      expect(await gap(), 'отступ во время смены шрифта').toBeGreaterThanOrEqual(16);
      await page.evaluate(() => document.fonts.ready);
      expect(await gap(), 'отступ после загрузки Onest').toBeGreaterThanOrEqual(16);
      const before = await lastFact.boundingBox();
      release();
      await expect(page.getByText('Загружаем дела…', { exact: true })).toHaveCount(0);
      const after = await title.boundingBox();
      // Ответ приходит именно между измерениями, как при исходном падении −9,203125 px.
      expect(before && after && after.y - before.y - before.height).toBeGreaterThanOrEqual(16);
      expect(await gap(), 'отступ после ответа API').toBeGreaterThanOrEqual(16);
      await expect(page.getByText('Дел пока нет', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
      await expectAccessible(page, `object-spacing-${percent}`);
      if (process.platform === 'linux') {
        await screenshot(page, info, `object-spacing-${percent}`);
        await copyFile(
          resolve(SCREENSHOT_DIR, info.project.name.slice(1), `object-spacing-${percent}.png`),
          resolve(
            import.meta.dirname,
            `../../test-results/screens/UI-4/${info.project.name}-object-spacing-${percent}.png`,
          ),
        );
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
