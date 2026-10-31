import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

for (const reduce of [false, true]) {
  test.describe(reduce ? 'reduce' : 'normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    test('UI-8: строка раскрывается в карточку и возвращается к прежнему месту', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      for (let n = 0; n < 24; n++)
        await api.post('tasks', {
          title: `Вымышленная строка ${String(n).padStart(2, '0')}`,
          planOn: homeDate(0),
        });
      await signInAs(page, family, 'adult');
      await settle(page);
      await page.evaluate(() => {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (update) => {
          const transition = start(update);
          void transition.ready.then(
            () => {
              const root = document.documentElement;
              root.dataset.spatialObserved = JSON.stringify({
                card: root.dataset.motionCard,
                direction: root.dataset.motionDirection,
                next: getComputedStyle(root, '::view-transition-new(screen)').animationName,
                old: getComputedStyle(root, '::view-transition-old(screen)').animationName,
                geometry: root.style.getPropertyValue('--card-transform'),
              });
            },
            () => {},
          );
          return transition;
        };
      });
      const link = page.getByRole('link', { name: 'Вымышленная строка 18', exact: true });
      await link.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await settle(page);
      const y = await page.evaluate(() => window.scrollY);
      expect(y).toBeGreaterThan(100);
      const row = await link.boundingBox();
      await link.click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Вымышленная строка 18' }),
      ).toBeVisible();
      await settle(page);
      const motion = JSON.parse(
        (await page.locator('html').getAttribute('data-spatial-observed')) ?? '{}',
      );
      expect(motion.card).toBe('forward');
      expect(motion.next).toBe(reduce ? 'motion-fade-in' : 'motion-card-in');
      expect(motion.geometry).toContain('scale(');
      await expectAccessible(page, 'UI-8 карточка из строки');
      if (process.platform === 'linux' && !reduce) {
        const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/spatial-motion');
        await mkdir(dir, { recursive: true });
        const path = resolve(dir, `card-${info.project.name}.png`);
        await page.screenshot({ path });
        await info.attach('Карточка', { path, contentType: 'image/png' });
      }
      await page.locator('.back-link').first().click();
      await expect(page).toHaveURL(/#\/today$/);
      await settle(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
      const restored = await link.boundingBox();
      expect(Math.abs((restored?.y ?? 0) - (row?.y ?? 0))).toBeLessThan(2);
      const back = JSON.parse(
        (await page.locator('html').getAttribute('data-spatial-observed')) ?? '{}',
      );
      expect(back.card).toBe('back');
      expect(back.old).toBe(reduce ? 'motion-fade-out' : 'motion-card-out');
      await expectNoHorizontalScroll(page);
      // Системная история также возвращает позицию, не перехватывая жест браузера.
      await link.click();
      await settle(page);
      await page.goBack();
      await settle(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    });
  });
}

test.describe('геометрия раскрытия', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('UI-8: боковая панель доступна во время раскрытия, следующий выбор сохраняет позу', async ({
    page,
    family,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAs(page, family, 'adult');
    await settle(page);
    const nav = page.locator('.side-nav');
    const home = nav.getByRole('link', { name: 'Дом', exact: true });
    await home.evaluate((node) => {
      if (!(node instanceof HTMLElement)) throw new Error('Sidebar link is missing');
      node.click();
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getTiming().iterations === Infinity) continue;
        animation.pause();
        animation.currentTime = 0;
      }
    });
    expect(
      await home.locator('.section-icon').evaluate((node) => {
        const box = node.getBoundingClientRect();
        return !!document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.closest('.side-nav');
      }),
    ).toBe(true);
    await page.evaluate(() => {
      for (const animation of document.getAnimations())
        if (animation.playState === 'paused') animation.currentTime = 120;
    });
    const before = await page.locator('.main:not([data-dock-ghost])').boundingBox();
    await nav.getByRole('link', { name: 'Люди', exact: true }).evaluate((node) => {
      if (node instanceof HTMLElement) node.click();
    });
    const picture = await page.locator('[data-dock-ghost]').boundingBox();
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs((before?.[key] ?? 0) - (picture?.[key] ?? 0))).toBeLessThan(1);
    await page.evaluate(() => {
      for (const animation of document.getAnimations())
        if (animation.playState === 'paused') animation.play();
    });
    await settle(page);
    await expect(page).toHaveURL(/#\/people$/);
    await expect(page.locator('[data-dock-ghost]')).toHaveCount(0);
  });
  test('UI-8: начальный размер окна совпадает со значком панели', async ({
    page,
    family,
  }, info) => {
    await signInAs(page, family, 'adult');
    await settle(page);
    const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/spatial-motion');
    if (process.platform === 'linux') {
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `dock-before-${info.project.name}.png`) });
    }
    const home = page.locator('.bottom-nav').getByRole('link', { name: 'Дом', exact: true });
    const source = await home.locator('.section-icon').boundingBox();
    await home.evaluate((node) => {
      if (!(node instanceof HTMLElement)) throw new Error('Dock link is missing');
      node.click();
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getTiming().iterations === Infinity) continue;
        animation.pause();
        animation.currentTime = 0;
      }
    });
    const start = await page.locator('.main:not([data-dock-ghost])').boundingBox();
    expect(Math.abs((start?.width ?? 0) - (source?.width ?? 0))).toBeLessThan(1);
    expect(Math.abs((start?.height ?? 0) - (source?.height ?? 0))).toBeLessThan(1);
    expect(Math.abs((start?.x ?? 0) - (source?.x ?? 0))).toBeLessThan(1);
    expect(Math.abs((start?.y ?? 0) - (source?.y ?? 0))).toBeLessThan(1);
    await page.evaluate(() => {
      for (const animation of document.getAnimations())
        if (animation.playState === 'paused') animation.currentTime = 120;
    });
    const middle = await page.locator('.main:not([data-dock-ghost])').boundingBox();
    expect(middle?.width ?? 0).toBeGreaterThan((source?.width ?? 0) * 2);
    if (process.platform === 'linux')
      await page.screenshot({ path: resolve(dir, `dock-middle-${info.project.name}.png`) });
    await page.evaluate(() => {
      for (const animation of document.getAnimations())
        if (animation.playState === 'paused') animation.play();
    });
    await settle(page);
    if (process.platform === 'linux') {
      const path = resolve(dir, `dock-after-${info.project.name}.png`);
      await page.screenshot({ path });
      await info.attach('Раскрытие из значка', { path, contentType: 'image/png' });
    }
    await expectAccessible(page, 'UI-8 раскрытие раздела');
    await expectNoHorizontalScroll(page);
    await expect(page.locator('[data-dock-ghost]')).toHaveCount(0);
  });
});
