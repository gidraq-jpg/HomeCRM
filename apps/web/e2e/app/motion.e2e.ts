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
  await expectAccessible(page, `D28-${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform !== 'linux') return;
  if (name.startsWith('reveal'))
    await page
      .locator('[data-swipe-open]')
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D28');
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, `${name}-${info.project.name}.png`),
    animations: 'disabled',
    fullPage: !name.startsWith('reveal'),
  });
}

/** Настоящие touch events Chromium: проверяем pointer capture и конфликт с вкладками. */
async function drag(page: Page, target: Locator, dx: number, dy = 0, slow = false) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Gesture target is missing');
  const width = page.viewportSize()?.width ?? 360;
  const longRowSwipe = dx !== 0 && !slow;
  const x = Math.min(
    width - 40,
    Math.max(
      40,
      longRowSwipe ? (dx > 0 ? box.x + 8 : box.x + box.width - 8) : box.x + box.width / 2,
    ),
  );
  // Длинный жест проходит больше половины строки независимо от загрузки CI.
  const travel = longRowSwipe ? (dx > 0 ? width - 28 - x : 28 - x) : dx;
  const y = box.y + Math.min(30, box.height / 2);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (travel * step) / 8, y: y + (dy * step) / 8 }],
      });
      if (slow) await page.waitForTimeout(80);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}
const row = (page: Page, title: string) =>
  page
    .locator('.swipe-task:not([data-motion-ghost])')
    .filter({ has: page.getByRole('group', { name: `Дело: ${title}`, exact: true }) });

test.use({ video: 'on' });

for (const reduce of [false, true]) {
  test.describe(reduce ? 'reduce' : 'normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });

    test('UI-8: переход в карточку и назад, dock, лист и fallback', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленный переход', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      const dock = await page.locator('.chrome').boundingBox();
      await page.getByRole('link', { name: 'Вымышленный переход', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Вымышленный переход' }),
      ).toBeVisible();
      await settle(page);
      await expect(page).toHaveTitle('Дело — HomeCRM');
      expect(await page.locator('.chrome').boundingBox()).toEqual(dock);
      await page.locator('.back-link').first().click();
      await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
      await settle(page);
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await settle(page);
      await page.evaluate(() => {
        let startY = 0;
        document.addEventListener(
          'pointerdown',
          (event) => {
            if ((event.target as Element).closest('.sheet__header')) startY = event.clientY;
          },
          true,
        );
        document.addEventListener(
          'pointerup',
          (event) => {
            if ((event.target as Element).closest('.sheet__header'))
              document.documentElement.dataset.sheetDraggedY = String(event.clientY - startY);
          },
          true,
        );
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const transform = Array.isArray(frames) ? frames[0]?.transform : undefined;
          if (this.classList.contains('sheet') && typeof transform === 'string')
            document.documentElement.dataset[
              this.hasAttribute('data-motion-ghost') ? 'sheetExitY' : 'sheetReturnY'
            ] = String(new DOMMatrixReadOnly(transform).m42);
          return animate.call(this, frames, options);
        };
      });
      await drag(page, sheet.locator('.sheet__header'), 0, 15, true);
      await expect(sheet).toBeVisible();
      if (!reduce) {
        expect(await sheet.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        const from = Number(await page.locator('html').getAttribute('data-sheet-return-y'));
        expect(from).toBeGreaterThan(10);
        expect(from).toBeLessThan(20);
      }
      await settle(page);
      await check(page, info, `sheet-${reduce}`);
      await drag(page, sheet.locator('.sheet__header'), 0, 260);
      await expect(sheet).toHaveCount(0);
      if (!reduce) {
        const delta = Number(await page.locator('html').getAttribute('data-sheet-dragged-y'));
        expect(delta).toBeGreaterThan(50);
        // Начало ухода совпадает с фактической координатой pointer, независимо от масштаба CDP.
        expect(Number(await page.locator('html').getAttribute('data-sheet-exit-y'))).toBeCloseTo(
          delta,
          1,
        );
      }
      await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeFocused();
      await page.getByRole('link', { name: 'Вымышленный переход', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Вымышленный переход' }),
      ).toBeVisible();
      await settle(page);
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(document, 'startViewTransition', {
          value: undefined,
          configurable: true,
        });
      });
      await page.getByRole('link', { name: 'Вымышленный переход', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Вымышленный переход', exact: true }),
      ).toBeVisible();
      await check(page, info, `card-${reduce}`);
    });

    for (const feed of ['today', 'today/plan', 'today/all']) {
      test(`UI-8: ${feed} — галочка, свайпы, отмена, клавиатура`, async ({
        page,
        family,
      }, info) => {
        await setHomeZone(family);
        const api = await apiAs(family, 'adult');
        await api.post('tasks', { title: 'Вымышленное дело', planOn: homeDate(0) });
        await api.post('tasks', { title: 'Вымышленный сосед', planOn: homeDate(0) });
        await signInAs(page, family, 'adult');
        if (feed !== 'today') await page.goto(`#/${feed}`);
        const task = row(page, 'Вымышленное дело');
        await expect(task).toBeVisible();
        await drag(page, task.locator('a').first(), -80, 0, true);
        await expect(task).toHaveAttribute('data-swipe-open', 'trash');
        await expect(page).toHaveURL(new RegExp(`#/${feed}$`));
        await check(page, info, `reveal-${feed.replace('/', '-')}-${reduce}`);
        const trash = task.getByRole('button', { name: 'В корзину', exact: true });
        await trash.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText('Дело в корзине', { exact: true })).toBeVisible();
        await expect(task).toHaveCount(0);
        await page.getByRole('button', { name: 'Отменить', exact: true }).click();
        await expect(page.getByText('Дело восстановлено', { exact: true })).toBeVisible();
        await expect(task).toBeVisible();
        await drag(page, task.locator('a').first(), 160);
        await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
        if (feed === 'today/all') await expect(task.locator('.plan-circle--done')).toBeVisible();
        else await expect(task).toHaveCount(0);
        await page.getByRole('button', { name: 'Отменить', exact: true }).click();
        await expect(task).toBeVisible();
        const neighbour = row(page, 'Вымышленный сосед');
        const completionButton = neighbour.getByRole('button', {
          name: /Выполнить|Отметить сделанным/,
        });
        let releaseRefresh = () => {};
        if (feed === 'today') {
          await page.route('**/api/tasks/*/status', (route) =>
            route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } }),
          );
          await completionButton.click();
          await expect(page.locator('.auth-notice--error')).toBeVisible();
          await expect(neighbour).toHaveAttribute('data-motion-completed', 'false');
          await page.unroute('**/api/tasks/*/status');
          const gate = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          });
          await page.route('**/api/tasks/today?*', async (route) => {
            await gate;
            await route.continue();
          });
        }
        await page.evaluate(() => {
          document.documentElement.dataset.checkStroke = 'false';
          const observer = new MutationObserver(() => {
            const strokes = document.querySelectorAll(
              '[data-motion-completed="true"] .plan-circle polyline, .plan-circle--done polyline',
            );
            for (const stroke of strokes) {
              const style = getComputedStyle(stroke);
              const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
              if (
                reduce ? style.animationName === 'none' : style.animationName === 'motion-check'
              ) {
                document.documentElement.dataset.checkStroke = 'true';
                observer.disconnect();
                break;
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        });
        try {
          await expect(completionButton).toBeEnabled();
          await completionButton.click();
          await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-check-stroke', 'true');
          if (feed === 'today') {
            await expect(completionButton).toBeEnabled();
            await settle(page);
            await expect(neighbour).toHaveAttribute('data-motion-completed', 'true');
            await page.evaluate(() => {
              document.documentElement.dataset.completionCollapse = 'false';
              const observer = new MutationObserver(() => {
                const ghost = document.querySelector<HTMLElement>(
                  '[data-motion-ghost][data-motion-completed="true"]',
                );
                if (!ghost) return;
                const animations = ghost.getAnimations();
                const collapse = animations.find((animation) =>
                  (animation.effect as KeyframeEffect).getKeyframes().some((frame) => frame.height),
                );
                const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (reduce ? !collapse : collapse?.effect?.getTiming().delay === 560) {
                  document.documentElement.dataset.completionCollapse = 'true';
                  observer.disconnect();
                }
              });
              observer.observe(document.body, { childList: true, subtree: true });
            });
          }
        } finally {
          releaseRefresh();
        }
        if (feed === 'today')
          await expect(page.locator('html')).toHaveAttribute('data-completion-collapse', 'true');
        await settle(page);
        await expect(page.locator('[data-motion-ghost]')).toHaveCount(0);
        await check(page, info, `completed-${feed.replace('/', '-')}-${reduce}`);
      });
    }

    test('UI-8: права ребёнка и отмена только у взрослого-автора', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      await signInAs(page, family, 'admin');
      const seeded = await page.evaluate(
        async (fields) => {
          const response = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(fields),
          });
          return response.status;
        },
        {
          title: 'Вымышленное общее дело',
          planOn: homeDate(0),
          placement: { spaceId: family.houseId, audience: 'household' },
        },
      );
      expect(seeded).toBe(201);
      await page.context().clearCookies();
      await signInAs(page, family, 'child');
      await page.goto('#/today/all');
      const task = row(page, 'Вымышленное общее дело');
      await expect(task).toBeVisible();
      await drag(page, task.locator('a').first(), -160);
      await expect(task).not.toHaveAttribute('data-swipe-open', 'trash');
      await expect(task.getByRole('button', { name: 'В корзину' })).toHaveCount(0);
      await check(page, info, `child-${reduce}`);
      // Новая вкладка получает сессию взрослого через обычную форму входа.
      await page.context().clearCookies();
      await page.goto('#/today');
      await signInAs(page, family, 'adult');
      await page.goto('#/today/all');
      await expect(task).toBeVisible();
      await drag(page, task.locator('a').first(), -160);
      await expect(page.getByText('Дело в корзине', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('status').getByRole('button', { name: 'Отменить', exact: true }),
      ).toHaveCount(0);
      await check(page, info, `adult-other-${reduce}`);
    });

    test('UI-8: заглушки пяти списков, затем обычное пустое состояние', async ({
      page,
      family,
    }, info) => {
      await signInAs(page, family, 'adult');
      for (const [path, endpoint] of [
        ['/today', '/api/tasks/today'],
        ['/today/all', '/api/tasks'],
        ['/home', '/api/objects'],
        ['/documents', '/api/documents'],
        ['/people', '/api/contacts'],
      ]) {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route('**/api/**', async (route) => {
          if (
            new URL(route.request().url()).pathname === endpoint &&
            route.request().method() === 'GET'
          )
            await gate;
          await route.continue();
        });
        await page.goto(`#${path}`);
        // Прямой переход может сохранить свежий кэш уже открытого Today.
        // Проверяем первичную загрузку, а не скорость фонового refetch.
        await page.reload();
        await expect(page.locator('.list-skeleton').first()).toBeVisible();
        await check(page, info, `loading-${path?.replaceAll('/', '-')}-${reduce}`);
        release();
        await expect(page.locator('.list-skeleton')).toHaveCount(0);
        await page.unroute('**/api/**');
      }
    });
  });
}
