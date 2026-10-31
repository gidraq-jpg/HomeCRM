import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

for (const reduce of [false, true]) {
  test.describe(reduce ? 'reduce' : 'normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    test('D37: плашка, экран, повторный выбор и история', async ({ page, family }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленная карточка D37', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await settle(page);
      const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/d37');
      if (process.platform === 'linux' && !reduce) {
        await mkdir(dir, { recursive: true });
        await page.screenshot({ path: resolve(dir, `before-${info.project.name}.png`) });
      }
      await page.evaluate(() => {
        const animate = Element.prototype.animate;
        Reflect.set(window, 'dockFrames', []);
        Element.prototype.animate = function (frames, options) {
          if (this.matches('.main, .section-icon, [data-dock-ghost]'))
            Reflect.get(window, 'dockFrames').push({ target: this.className, frames, options });
          return animate.call(this, frames, options);
        };
      });
      const nav = page.locator('.bottom-nav');
      const home = nav.getByRole('link', { name: 'Дом', exact: true });
      const homeBox = await home.boundingBox();
      if (!homeBox) throw new Error('Dock button is missing');
      await page.mouse.move(homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height / 2);
      await page.mouse.down();
      await expect(home.locator('svg')).toHaveCSS(
        'transform',
        reduce ? 'none' : 'matrix(0.86, 0, 0, 0.86, 0, 0)',
      );
      await page.mouse.up();
      await expect(page).toHaveURL(/#\/home$/);
      await settle(page);
      const indicator = nav.locator('.section-indicator');
      const active = nav.locator('[aria-current="page"]');
      const pill = await indicator.boundingBox();
      const button = await active.boundingBox();
      expect(pill).not.toBeNull();
      expect(button).not.toBeNull();
      expect(Math.abs((pill?.x ?? 0) - (button?.x ?? 0))).toBeLessThan(1);
      expect(Math.abs((pill?.width ?? 0) - (button?.width ?? 0))).toBeLessThan(1);
      const frames = await page.evaluate(() => Reflect.get(window, 'dockFrames'));
      if (reduce) {
        expect(JSON.stringify(frames)).not.toContain('scale(');
        expect(await indicator.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
          '0s',
        );
      } else {
        expect(JSON.stringify(frames)).not.toContain('scale(0.88)');
        expect(JSON.stringify(frames)).toContain('scale(1, 1)');
        expect(JSON.stringify(frames)).toContain('400');
        expect(await indicator.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
          '0.42s',
        );
      }
      await expectAccessible(page, 'D37 Дом');
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
      if (process.platform === 'linux' && !reduce) {
        const path = resolve(dir, `after-${info.project.name}.png`);
        await page.screenshot({ path });
        await info.attach('D37 после выбора', { path, contentType: 'image/png' });
      }
      await nav.getByRole('link', { name: 'Сегодня', exact: true }).click();
      await settle(page);
      await page.getByRole('link', { name: 'Вымышленная карточка D37', exact: true }).click();
      await settle(page);
      await nav.getByRole('link', { name: 'Сегодня', exact: true }).click();
      await expect(page).toHaveURL(/#\/today$/);
      await settle(page);
      // Удлиняем только тестовый корень, независимо от количества записей семьи.
      await page.locator('.main').evaluate((el) => {
        el.style.minHeight = '2400px';
      });
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await nav.getByRole('link', { name: 'Сегодня', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await nav.getByRole('link', { name: 'Люди', exact: true }).click();
      await settle(page);
      await page.goBack();
      await settle(page);
      expect(await indicator.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
      await expect(page.locator('[data-dock-ghost]')).toHaveCount(0);
      await expectAccessible(page, 'D37 Сегодня');
      await page.setViewportSize({ width: 1280, height: 800 });
      const sidebar = page.locator('.side-nav');
      await sidebar.getByRole('link', { name: 'Дом', exact: true }).click();
      await settle(page);
      const sidePill = await sidebar.locator('.section-indicator').boundingBox();
      const sideButton = await sidebar.locator('[aria-current="page"]').boundingBox();
      expect(sidePill).not.toBeNull();
      expect(sideButton).not.toBeNull();
      expect(Math.abs((sidePill?.y ?? 0) - (sideButton?.y ?? 0))).toBeLessThan(1);
      await page.goto('#/today');
      await page.getByRole('link', { name: 'Вымышленная карточка D37', exact: true }).click();
      await settle(page);
      await sidebar.getByRole('link', { name: 'Сегодня', exact: true }).click();
      await expect(page).toHaveURL(/#\/today$/);
    });
  });
}
