import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

for (const reduce of [false, true]) {
  test.describe(reduce ? 'reduce' : 'normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    test('D44: карточка выезжает справа и возвращает прежнее место чтения', async ({
      page,
      family,
    }) => {
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
              const next = getComputedStyle(root, '::view-transition-new(screen)');
              const old = getComputedStyle(root, '::view-transition-old(screen)');
              root.dataset.spatialObserved = JSON.stringify({
                card: root.dataset.motionCard,
                direction: root.dataset.motionDirection,
                next: next.animationName,
                old: old.animationName,
                geometry: root.style.getPropertyValue('--card-clip'),
                // D38: первый кадр — окно, без неравномерного масштаба снимка.
                nextClip: next.clipPath,
                oldClip: old.clipPath,
                nextTransform: next.transform,
                oldTransform: old.transform,
                main: (() => {
                  const box = document.querySelector('.main')?.getBoundingClientRect();
                  const group = getComputedStyle(root, '::view-transition-group(screen)');
                  const snapshotHeight = Number.parseFloat(
                    next.height.endsWith('px') ? next.height : group.height,
                  );
                  const snapshotWidth = Number.parseFloat(
                    next.width.endsWith('px') ? next.width : group.width,
                  );
                  return (
                    box && {
                      x: box.x,
                      y: box.y,
                      right: box.x + snapshotWidth,
                      bottom: box.y + snapshotHeight,
                    }
                  );
                })(),
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
      expect(motion.direction).toBe('forward');
      expect(motion.next).toBe(reduce ? 'motion-fade-in' : 'motion-side-in');
      expect(motion.geometry).toBe('');
      expect(motion.nextClip).toBe('none');
      expect(motion.oldClip).toBe('none');
      if (reduce) expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(motion.nextTransform);
      await expectAccessible(page, 'D44 карточка из строки');
      await page.locator('.back-link').first().click();
      await expect(page).toHaveURL(/#\/today$/);
      await settle(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
      const restored = await link.boundingBox();
      expect(Math.abs((restored?.y ?? 0) - (row?.y ?? 0))).toBeLessThan(2);
      const back = JSON.parse(
        (await page.locator('html').getAttribute('data-spatial-observed')) ?? '{}',
      );
      expect(back.direction).toBe('back');
      expect(back.old).toBe(reduce ? 'motion-fade-out' : 'motion-side-out');
      expect(back.oldClip).toBe('none');
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

test.describe('очередь разделов D39', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('UI-8: повторный выбор раздела завершается без клона и потери адреса', async ({
    page,
    family,
  }) => {
    await signInAs(page, family, 'adult');
    await settle(page);
    await page.locator('.bottom-nav').getByRole('link', { name: 'Дом', exact: true }).click();
    await page
      .locator('.bottom-nav')
      .getByRole('link', { name: 'Люди', exact: true })
      .evaluate((node) => (node as HTMLElement).click());
    await expect(page).toHaveURL(/#\/people$/);
    await settle(page);
    await expect(page.locator('[data-dock-ghost]')).toHaveCount(0);
    await expectAccessible(page, 'D39 очередь разделов');
  });
});
