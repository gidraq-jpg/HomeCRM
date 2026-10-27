import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
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

export async function touchSwipe(
  page: Page,
  target: Locator,
  dx: number,
  inspect?: () => Promise<void>,
) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing gesture target');
  const x =
    dx < 0
      ? Math.min((page.viewportSize()?.width ?? 360) - 35, box.x + box.width - 35)
      : Math.max(35, box.x + 35);
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
    await inspect?.();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test.use({ video: 'on' });
test('D32: выполненное дело без даты остаётся в счётчике видимой группы', async ({
  page,
  family,
}) => {
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Вымышленное дело без даты' });
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  const row = page.getByRole('group', { name: 'Дело: Вымышленное дело без даты', exact: true });
  await row
    .getByRole('button', { name: 'Отметить сделанным: Вымышленное дело без даты', exact: true })
    .click();
  await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
  await settle(page);
  const group = page
    .locator('.section')
    .filter({ has: page.getByRole('heading', { name: 'Без даты', exact: true }) });
  await expect(group.locator('.section__head .muted')).toHaveText('1');
  await expect(row).toBeVisible();
});
test('D32: запись карусели 412 px с касанием', async ({ page, family, browser }, info) => {
  test.skip(info.project.name !== 'w412', 'Запись мобильной раскладки — один раз');
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Вымышленное дело записи', planOn: homeDate(0) });
  await signInAs(page, family, 'adult');
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D32/after');
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    reducedMotion: 'no-preference',
    recordVideo: { dir, size: { width: 412, height: 915 } },
  });
  const demo = await context.newPage();
  try {
    await demo.goto(`${family.baseURL}#/today`);
    await expect(demo.locator('[data-feed-ready="true"]')).toHaveCount(4);
    for (let index = 1; index < 4; index++) {
      await touchSwipe(demo, demo.locator('.feed-heading'), -150);
      await expect(demo.locator('.feed-carousel')).toHaveAttribute(
        'data-feed-index',
        String(index),
      );
      await settle(demo);
    }
  } finally {
    await context.close();
  }
  const video = resolve(dir, 'carousel-412.webm');
  await demo.video()?.saveAs(video);
  await info.attach('Карусель 412 px', { path: video, contentType: 'video/webm' });
});
for (const reduce of [false, true])
  test(`D32: карусель и неподвижная шапка, reduce=${reduce}`, async ({ page, family }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    expect(
      (await api.post('tasks', { title: 'Вымышленное дело карусели', planOn: homeDate(0) })).status,
    ).toBe(201);
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await signInAs(page, family, 'adult');
    await expect(page.locator('[data-feed-ready="true"]')).toHaveCount(4);
    const tabs = page.locator('.today-tabs');
    const add = tabs.locator('.studio-add');
    const first = await tabs.boundingBox();
    const plus = await add.boundingBox();
    const dir = resolve(import.meta.dirname, '../../test-results/screens/D32/after');
    await mkdir(dir, { recursive: true });
    for (let index = 0; index < 4; index++) {
      if (index) {
        const target = page.locator('.feed-heading');
        await touchSwipe(page, target, -140, async () => {
          if (reduce) return;
          const next = page.locator(`[data-feed-pane="${index}"]`);
          await expect(next).toHaveAttribute('inert', '');
          const box = await next.boundingBox();
          expect(box?.x).toBeLessThan(page.viewportSize()?.width ?? 0);
          expect(box?.x).toBeGreaterThan(0);
          await expect(next.locator('.task-feed-content')).toBeVisible();
          await expect(next.locator('.list-skeleton')).toHaveCount(0);
          await page.screenshot({ path: resolve(dir, `drag-${index}-${info.project.name}.png`) });
        });
        await expect(page.locator('.feed-carousel')).toHaveAttribute(
          'data-feed-index',
          String(index),
        );
        await settle(page);
      }
      const current = await tabs.boundingBox();
      const button = await add.boundingBox();
      expect(Math.abs((current?.y ?? 0) - (first?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((button?.x ?? 0) - (plus?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((button?.y ?? 0) - (plus?.y ?? 0))).toBeLessThanOrEqual(1);
      await expect(page.locator('.bottom-nav [aria-current="page"]')).toHaveAttribute(
        'href',
        '#/today',
      );
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
      await expectAccessible(page, `D32-feed-${index}-${reduce}`);
      await page.screenshot({
        path: resolve(dir, `feed-${index}-${reduce}-${info.project.name}.png`),
        animations: 'disabled',
      });
    }
    await touchSwipe(page, page.locator('.feed-heading'), -100);
    await expect(page.locator('.feed-carousel')).toHaveAttribute('data-feed-index', '3');
    await tabs.getByRole('link', { name: 'Сегодня', exact: true }).click();
    await settle(page);
    await expect(page.locator('.feed-carousel')).toHaveAttribute('data-feed-index', '0');
    await expect(page.locator('[data-motion-flight]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-motion-feed');
  });
