import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test('D32: светлая панель до низа, без подложки и следов перехода', async ({
  page,
  family,
}, info) => {
  test.setTimeout(120_000);
  const before = process.env.D32_PHASE === 'before';
  const dir = resolve(
    import.meta.dirname,
    '../../test-results/screens/D32',
    before ? 'before' : 'after',
  );
  await mkdir(dir, { recursive: true });
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Вымышленное дело D32' });
  await signInAs(page, family, 'adult');
  for (const width of [360, 412, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 915 });
    for (const route of ['home', 'documents', 'people', 'more', 'today/all']) {
      await page.goto(`${family.baseURL}#/${route}`);
      await settle(page);
      await expect(page.locator('.page')).toBeVisible();
      if (route === 'today/all')
        await expect(
          page.getByRole('link', { name: 'Вымышленное дело D32', exact: true }),
        ).toBeVisible();
      await page.screenshot({
        path: resolve(dir, `${route.replaceAll('/', '-')}-${width}.png`),
        animations: 'disabled',
      });
      if (before) continue;
      await expectNoHorizontalScroll(page);
      const geometry = await page.locator('.main').evaluate((main) => {
        const box = main.getBoundingClientRect();
        const node = document.elementFromPoint(box.x + box.width / 2, innerHeight - 2);
        let painted = node;
        while (
          painted?.parentElement &&
          getComputedStyle(painted).backgroundColor === 'rgba(0, 0, 0, 0)'
        )
          painted = painted.parentElement;
        return {
          bottom: box.bottom,
          height: innerHeight,
          background: getComputedStyle(main).backgroundColor,
          paper: getComputedStyle(document.querySelector('.app') ?? main).backgroundColor,
          covered: !!node && main.contains(node),
          bottomColor: painted ? getComputedStyle(painted).backgroundColor : '',
          dark: getComputedStyle(document.querySelector('.topbar') ?? main).backgroundColor,
        };
      });
      expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.height - 1);
      expect(geometry.background).toBe(geometry.paper);
      expect(geometry.covered).toBe(true);
      expect(geometry.bottomColor).not.toBe(geometry.dark);
      if (width <= 412) await expectAccessible(page, `D32-${route}-${width}`);
    }
  }
  if (before) return;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('link', { name: 'Вымышленное дело D32', exact: true }).click();
  await settle(page);
  await page.locator('.back-link').first().click();
  await settle(page);
  expect(
    await page
      .locator('html')
      .evaluate((root) =>
        root.getAttributeNames().filter((name) => name.startsWith('data-motion-')),
      ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              animation.effect.pseudoElement?.startsWith('::view-transition'),
          ).length,
    ),
  ).toBe(0);
  await page.goto(`${family.baseURL}#/today/all`);
  await expect(page.getByRole('link', { name: 'Вымышленное дело D32', exact: true })).toBeVisible();
  expect(
    await page
      .locator('.swipe-task__actions')
      .first()
      .evaluate((node) => getComputedStyle(node).visibility),
  ).toBe('hidden');
  await info.attach('Снимки D32', { body: dir, contentType: 'text/plain' });
});
