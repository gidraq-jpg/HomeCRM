import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
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

async function check(page: Page, info: TestInfo, name: string) {
  await settle(page);
  await expectAccessible(page, `D30-${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform !== 'linux') return;
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D30');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${name}-${info.project.name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function observe(page: Page) {
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const transition = start(update);
      void transition.ready.then(
        () => {
          const root = document.documentElement;
          const old = getComputedStyle(root, '::view-transition-old(screen)');
          const next = getComputedStyle(root, '::view-transition-new(screen)');
          root.dataset.observedMotion = JSON.stringify({
            direction: root.dataset.motionDirection,
            feed: root.dataset.motionFeed,
            old: old.animationName,
            next: next.animationName,
            duration: next.animationDuration,
            shadow: next.boxShadow,
            radius: next.borderTopLeftRadius,
            dock: getComputedStyle(root, '::view-transition-new(dock)').animationName,
            header: getComputedStyle(root, '::view-transition-new(header)').animationName,
          });
        },
        () => {},
      );
      return transition;
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (
        this.classList.contains('feed-carousel__track') &&
        Array.isArray(frames) &&
        frames.every((frame) => !frame.transform)
      )
        document.documentElement.dataset.feedFade = 'true';
      if (this.classList.contains('feed-carousel__track'))
        document.documentElement.dataset.observedFeed = JSON.stringify({ frames, options });
      if (this.parentElement?.classList.contains('rolling-number'))
        document.documentElement.dataset.rollingCount = String(
          Number(document.documentElement.dataset.rollingCount ?? 0) + 1,
        );
      return animate.call(this, frames, options);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.hasAttribute('data-motion-flight')) {
            document.documentElement.dataset.flightCount = String(
              Number(document.documentElement.dataset.flightCount ?? 0) + 1,
            );
            document.documentElement.dataset.flightAccessible = `${node.getAttribute('aria-hidden')}:${node.inert}:${getComputedStyle(node).pointerEvents}`;
          }
        }
    });
    observer.observe(document.body, { childList: true });
  });
}
async function observed(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-observed-motion', /direction/);
  return JSON.parse((await page.locator('html').getAttribute('data-observed-motion')) ?? '{}');
}
const row = (page: Page, title: string) =>
  page
    .locator('.swipe-task:not([data-motion-ghost])')
    .filter({ has: page.getByRole('group', { name: `Дело: ${title}`, exact: true }) });

/** CDP даёт настоящие touch/pointer capture, включая браузерную отмену вертикального жеста. */
async function swipe(
  page: Page,
  target: Locator,
  dx: number,
  dy = 0,
  inspect?: () => Promise<void>,
  fast = false,
) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing gesture target');
  const x = Math.min(
    (page.viewportSize()?.width ?? 360) - 36,
    Math.max(36, fast ? box.x + box.width - 8 : box.x + box.width / 2),
  );
  const y = box.y + Math.min(24, box.height / 2);
  // Длинный жест доходит почти до края экрана: действие — только дальше 65 % строки.
  const travel = fast ? 8 - x : dx;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (travel * step) / 8, y: y + (dy * step) / 8 }],
      });
      await page.waitForTimeout(fast ? 10 : 40);
    }
    await inspect?.();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test.use({ video: 'on' });
for (const reduce of [false, true])
  test.describe(reduce ? 'reduce' : 'normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    test('D30: список → карточка → форма → Назад, история и шапка', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленный переход D30', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await observe(page);
      const dock = await page.locator('.chrome').boundingBox();
      await page.getByRole('link', { name: 'Вымышленный переход D30', exact: true }).click();
      await settle(page);
      let motion = await observed(page);
      expect(motion.direction).toBe('forward');
      expect(motion.next).toBe(reduce ? 'motion-fade-in' : 'motion-screen-in');
      expect(motion.duration).toBe(reduce ? '0.16s' : '0.4s');
      expect(motion.dock).toBe('none');
      expect(motion.header).toBe('none');
      if (!reduce) {
        expect(motion.shadow).not.toBe('none');
        expect(motion.radius).toBe('32px');
      }
      await check(page, info, `card-${reduce}`);
      await page.getByRole('button', { name: 'Править дело', exact: true }).click();
      await expect(page.locator('.ui7-fullscreen-form')).toBeVisible();
      await settle(page);
      motion = await observed(page);
      expect(motion.header).toBe('motion-fade-in');
      await check(page, info, `form-${reduce}`);
      await page.locator('.back-link').first().click();
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
      await settle(page);
      expect((await observed(page)).direction).toBe('back');
      await page.locator('.back-link').first().click();
      await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
      await settle(page);
      expect((await observed(page)).next).toBe(reduce ? 'motion-fade-in' : 'motion-screen-back-in');
      expect(await page.locator('.chrome').boundingBox()).toEqual(dock);
      // Прямой системный popstate не перехватывается и сохраняет штатную историю.
      await page.getByRole('link', { name: 'Вымышленный переход D30', exact: true }).click();
      await settle(page);
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
      await expect(page.locator('html')).not.toHaveAttribute('data-motion-direction');
      // Общий navigate(-1) у FormHeading без перевода HashRouter на data router.
      await page.getByRole('link', { name: 'Поиск', exact: true }).click();
      await settle(page);
      await page.evaluate(() => {
        delete document.documentElement.dataset.observedMotion;
      });
      await page.locator('.back-link').first().click();
      await settle(page);
      await expect(page).toHaveURL(/#\/today$/);
      expect((await observed(page)).direction).toBe('back');
      await check(page, info, `back-${reduce}`);
    });

    test('D30: вкладки за пальцем, короткий возврат, направление нажатия и строки', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленная строка D30', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await observe(page);
      const content = page.locator('.feed-carousel__track');
      const dock = await page.locator('.chrome').boundingBox();
      await swipe(page, page.locator('.task-counts'), -25, 0, async () => {
        const transform = await content.evaluate((node) => getComputedStyle(node).transform);
        expect(transform === 'none').toBe(reduce);
        expect(await page.locator('.chrome').boundingBox()).toEqual(dock);
      });
      await settle(page);
      await expect(page).toHaveURL(/#\/today$/);
      expect(await content.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
      await swipe(page, row(page, 'Вымышленная строка D30').locator('a').first(), -70);
      await expect(page).toHaveURL(/#\/today$/);
      await page
        .getByRole('heading', { name: 'Сегодня', exact: true })
        .evaluate(() => scrollTo(0, 0));
      await swipe(page, page.locator('.task-counts'), -120);
      await expect(page).toHaveURL(/#\/today\/plan$/);
      await settle(page);
      if (reduce) await expect(page.locator('html')).toHaveAttribute('data-feed-fade', 'true');
      else
        expect(
          JSON.parse((await page.locator('html').getAttribute('data-observed-feed')) ?? '{}')
            .options.duration,
        ).toBe(400);
      await swipe(page, page.locator('.plan-day__title').first(), -120);
      await expect(page).toHaveURL(/#\/today\/all$/);
      await settle(page);
      await check(page, info, `all-${reduce}`);
      await page.getByRole('link', { name: 'Сегодня', exact: true }).first().click();
      await settle(page);
      if (!reduce) {
        const motion = JSON.parse(
          (await page.locator('html').getAttribute('data-observed-feed')) ?? '{}',
        );
        expect(motion.options.duration).toBe(240);
        expect(motion.frames[0].transform).toMatch(/translateX\(-/);
      }
      await page.getByRole('link', { name: 'Покупки', exact: true }).click();
      await expect(page).toHaveURL(/#\/more\/shopping$/);
      await settle(page);
      if (!reduce)
        expect(
          JSON.parse((await page.locator('html').getAttribute('data-observed-feed')) ?? '{}')
            .frames[0].transform,
        ).not.toMatch(/translateX\(-/);
      await check(page, info, `shopping-${reduce}`);
    });

    test('D30: подтверждённый улёт, счётчик, отмена и ошибка API', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленный улёт D30', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await observe(page);
      const task = row(page, 'Вымышленный улёт D30');
      await page.route('**/api/tasks/*/status', (route) =>
        route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } }),
      );
      await task.getByRole('button', { name: 'Выполнить', exact: true }).click();
      await expect(page.locator('.auth-notice--error')).toBeVisible();
      await expect(task).toBeVisible();
      await expect(page.locator('html')).not.toHaveAttribute('data-flight-count');
      await page.unroute('**/api/tasks/*/status');
      await task.getByRole('button', { name: 'Выполнить', exact: true }).click();
      await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
      await expect(page.locator('.task-counts')).toHaveText('Осталось 0 · Выполнено 1');
      if (!reduce) {
        await expect(page.locator('html')).toHaveAttribute('data-flight-count', '1');
        await expect(page.locator('html')).toHaveAttribute('data-rolling-count', /[1-9]/);
        await expect(page.locator('html')).toHaveAttribute(
          'data-flight-accessible',
          'true:true:none',
        );
      }
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      await expect(task).toBeVisible();
      if (!reduce) await expect(page.locator('html')).toHaveAttribute('data-flight-count', '2');
      await settle(page);
      await swipe(page, task.locator('a').first(), -160, 0, undefined, true);
      await expect(page.getByText('Дело в корзине', { exact: true })).toBeVisible();
      if (!reduce) await expect(page.locator('html')).toHaveAttribute('data-flight-count', '3');
      await expect(task).toHaveCount(0);
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      await expect(page.getByText('Дело восстановлено', { exact: true })).toBeVisible();
      await expect(task).toBeVisible();
      if (!reduce) await expect(page.locator('html')).toHaveAttribute('data-flight-count', '4');
      else await expect(page.locator('html')).not.toHaveAttribute('data-flight-count');
      if (reduce) await expect(page.locator('html')).not.toHaveAttribute('data-rolling-count');
      await settle(page);
      await expect(page.locator('[data-motion-flight]')).toHaveCount(0);
      await check(page, info, `restored-${reduce}`);
    });
  });
