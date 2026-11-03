import { expect, test } from '../auth/support/fixtures.ts';
import { checkScreen, settle } from '../support/helpers.ts';
import { homeDate } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

test.use({ video: 'on' });
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`round2-${reducedMotion}`, () => {
    test.use({ reducedMotion });
    test('нажатия вкладок, прерывания до и после выхода, свайп', async ({ page, family }, info) => {
      const api = await apiAs(family, 'adult');
      for (let i = 0; i < 5; i++)
        expect(
          (await api.post('tasks', { title: `Сценарий вкладки ${i}`, planOn: homeDate(0) })).status,
        ).toBe(201);
      await signInAs(page, family, 'adult');
      await expect(page.locator('[data-feed-ready="true"]')).toHaveCount(4);
      await settle(page);
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Object.assign(window, { feedCalls: [] });
        Element.prototype.animate = function (frames, options) {
          const animation = original.call(this, frames, options);
          if (this.closest('.feed-carousel')) {
            (window as unknown as { feedCalls: unknown[] }).feedCalls.push({
              frames,
              options,
              track: this.classList.contains('feed-carousel__track'),
            });
            animation.pause();
          }
          return animation;
        };
      });
      const choose = async (name: string) =>
        page
          .getByRole('navigation', { name: 'Ленты дел' })
          .getByRole('link', { name, exact: true })
          .evaluate((node) => (node as HTMLElement).click());
      await choose('План');
      await expect(page.locator('.feed-tab-ghost')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'План', exact: true })).toHaveCount(1);
      const calls = await page.evaluate(
        () =>
          (
            window as unknown as {
              feedCalls: {
                track: boolean;
                options: KeyframeAnimationOptions;
                frames: Record<string, unknown>[];
              }[];
            }
          ).feedCalls,
      );
      expect(calls.every((call) => !call.track)).toBe(true);
      expect(
        calls.some((call) => call.options.duration === (reducedMotion === 'reduce' ? 160 : 240)),
      ).toBe(true);
      if (reducedMotion === 'reduce')
        expect(
          calls.every(
            (call) => !call.options.delay && call.frames.every((frame) => !('transform' in frame)),
          ),
        ).toBe(true);
      else expect(calls.some((call) => call.options.delay === 304)).toBe(true);
      await page.screenshot({ path: info.outputPath('tab-forward-start.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.currentTime = 80;
          });
      });
      const beforeExit = await page.locator('.feed-tab-ghost').evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        opacity: Number(getComputedStyle(node).opacity),
      }));
      await choose('Все дела');
      const afterExit = await page.locator('.feed-tab-ghost').evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        opacity: Number(getComputedStyle(node).opacity),
      }));
      expect(afterExit.left).toBeCloseTo(beforeExit.left, 1);
      expect(afterExit.opacity).toBeCloseTo(beforeExit.opacity, 2);

      await expect(page.locator('.feed-tab-ghost')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath('tab-rapid-exit.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.currentTime = 200;
          });
      });
      await page.locator('.feed-tab-ghost').evaluate((node) =>
        node.getAnimations().forEach((animation) => {
          animation.finish();
        }),
      );
      await expect(page.locator('.feed-tab-ghost')).toHaveCount(0);
      const visibleRow = page
        .locator('[data-feed-active="true"] li[data-motion-key]:not([data-motion-ghost])')
        .first();
      const beforeIncoming = await visibleRow.evaluate((node) => ({
        key: (node as HTMLElement).dataset.motionKey,
        left: node.getBoundingClientRect().left,
        opacity: Number(getComputedStyle(node).opacity),
      }));
      await choose('Сегодня');
      const afterIncoming = await page
        .locator('.feed-tab-ghost [data-motion-key]')
        .evaluateAll((nodes, key) => {
          const node = nodes.find((item) => (item as HTMLElement).dataset.motionKey === key);
          if (!node) throw new Error('Missing snapshot row');
          return {
            left: node.getBoundingClientRect().left,
            opacity: Number(getComputedStyle(node).opacity),
          };
        }, beforeIncoming.key);
      expect(afterIncoming.left).toBeCloseTo(beforeIncoming.left, 1);
      expect(afterIncoming.opacity).toBeCloseTo(beforeIncoming.opacity, 2);
      await page.screenshot({ path: info.outputPath('tab-back-incoming.png') });
      const count = await page.evaluate(
        () => (window as unknown as { feedCalls: unknown[] }).feedCalls.length,
      );
      await choose('Сегодня');
      expect(
        await page.evaluate(() => (window as unknown as { feedCalls: unknown[] }).feedCalls.length),
      ).toBe(count);
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await expect(page.locator('.feed-tab-ghost')).toHaveCount(0);
      await expect(page.locator('.feed-carousel__track')).not.toHaveAttribute(
        'style',
        /min-height/,
      );
      expect(
        await page
          .locator('[data-feed-active="false"]')
          .evaluateAll((nodes) =>
            nodes.every(
              (node) => (node as HTMLElement).inert && node.getAttribute('aria-hidden') === 'true',
            ),
          ),
      ).toBe(true);
      await checkScreen(page, info, `round2-tabs-${reducedMotion}`);
      // Настоящий CDP touch: свободная область ленты, вне строк и фильтров.
      const box = await page.locator('.feed-carousel').boundingBox();
      if (!box) throw new Error('Missing feed');
      const y = Math.min((page.viewportSize()?.height ?? 740) - 140, box.y + 15);
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 280, y }],
      });
      for (let i = 1; i <= 5; i++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 280 - i * 42, y }],
        });
      await page.screenshot({ path: info.outputPath('swipe-follow.png') });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
      await expect(page.getByRole('heading', { name: 'План', exact: true })).toHaveCount(1);
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await checkScreen(page, info, `round2-swipe-${reducedMotion}`);
    });

    test('общие строки, перестановка, refetch, пустое состояние и фокус', async ({
      page,
      family,
    }, info) => {
      const api = await apiAs(family, 'adult');
      const first = await seedNote(api, family, { title: 'Общее Альфа' });
      await seedNote(api, family, { title: 'Общее Бета' });
      await seedNote(api, family, { title: 'Другое Гамма' });
      await signInAs(page, family, 'adult');
      await page.goto('#/more/notes');
      await settle(page);
      const rows = page.locator('.row-list > li');
      await expect(rows).toHaveCount(3);
      const alpha = rows.filter({ hasText: 'Общее Альфа' });
      await alpha.evaluate((node) => node.setAttribute('data-identity-proof', 'preserved'));
      const filter = page.getByLabel('Найти по заголовку');
      await filter.fill('Общее');
      await settle(page);
      await expect(rows).toHaveCount(2);
      await expect(alpha).toHaveAttribute('data-identity-proof', 'preserved');
      await expect(page.locator('.content-motion > [data-motion-ghost]')).toHaveCount(0);
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const animation = original.call(this, frames, options);
          if (this.matches('.row-list > li, .notes-pinned > li')) animation.pause();
          return animation;
        };
      });
      expect(
        (
          await api.patch(`notes/${first.id}`, {
            body: 'Учебное обновление',
            expectedUpdatedAt: first.updatedAt,
          })
        ).status,
      ).toBe(200);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      await expect.poll(() => rows.first().innerText()).toContain('Общее Альфа');
      await expect(alpha).toHaveAttribute('data-identity-proof', 'preserved');
      if (reducedMotion === 'no-preference')
        await expect
          .poll(() => alpha.evaluate((node) => node.getAnimations().length))
          .toBeGreaterThan(0);
      await page.screenshot({ path: info.outputPath('reorder-existing.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await filter.fill('Пустой результат');
      await expect(page.getByText('Ничего не нашли среди загруженных заметок.')).toBeVisible();
      await expect(filter).toBeFocused();
      await checkScreen(page, info, `round2-notes-empty-${reducedMotion}`);
      await seedNote(api, family, { title: 'Закреплено Альфа', pinned: true });
      await seedNote(api, family, { title: 'Закреплено Бета', pinned: true });
      await filter.fill('');
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      await expect(page.locator('.notes-pinned > li:not([data-motion-ghost])')).toHaveCount(2);
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await settle(page);
      await filter.fill('Закреплено Альфа');
      await expect(page.locator('.notes-pinned > [data-motion-ghost]')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath('pinned-remove-partial.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await expect(page.locator('.notes-pinned > [data-motion-ghost]')).toHaveCount(0);
      await checkScreen(page, info, `round2-notes-pinned-${reducedMotion}`);
    });

    test('кнопка pending, отказ API и сужение 412→360', async ({ page, family }, info) => {
      await signInAs(page, family, 'adult');
      await page.setViewportSize({ width: 412, height: 915 });
      await page.goto('#/more/notes/new');
      await settle(page);
      await page.getByLabel('Заголовок', { exact: true }).fill('Учебный отказ');
      const button = page.locator(
        '.form-submit-bar button[type="submit"]:not([data-motion-ghost])',
      );
      await expect(button).toBeVisible();
      await page.setViewportSize({ width: 360, height: 740 });
      const resized = await button.boundingBox();
      expect(resized?.x).toBeGreaterThanOrEqual(0);
      expect((resized?.x ?? 0) + (resized?.width ?? 0)).toBeLessThanOrEqual(360);
      await checkScreen(page, info, `round2-form-resize-${reducedMotion}`);
      await page.setViewportSize(info.project.use.viewport ?? { width: 360, height: 740 });
      let release = () => {};
      const barrier = new Promise<void>((done) => {
        release = done;
      });
      await page.route('**/api/notes', async (route) => {
        await barrier;
        await route.fulfill({ status: 400, json: { code: 'INTERNAL_ERROR' } });
      });
      const before = await button.boundingBox();
      await button.click();
      await expect(button).toHaveText('Сохраняем…');
      const pending = await button.boundingBox();
      expect(pending?.width).toBe(before?.width);
      expect(pending?.height).toBe(before?.height);
      await page.screenshot({ path: info.outputPath('submit-pending.png') });
      release();
      await expect(button).toHaveText('Сохранить');
      await expect(page.getByLabel('Заголовок', { exact: true })).toHaveValue('Учебный отказ');
      await expect(page).toHaveURL(/notes\/new/);
      await checkScreen(page, info, `round2-form-failure-${reducedMotion}`);
    });

    test('загрузка → данные только fast и refetch без повторного появления', async ({
      page,
      family,
    }, info) => {
      const api = await apiAs(family, 'adult');
      await seedNote(api, family, { title: 'Учебная загрузка' });
      await signInAs(page, family, 'adult');
      let release = () => {};
      const barrier = new Promise<void>((done) => {
        release = done;
      });
      await page.route('**/api/notes?*', async (route) => {
        await barrier;
        await route.continue();
      });
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Object.assign(window, { loadingCalls: 0 });
        Element.prototype.animate = function (frames, options) {
          const animation = original.call(this, frames, options);
          if (this.closest('.content-motion')) {
            (window as unknown as { loadingCalls: number }).loadingCalls++;
            animation.pause();
          }
          return animation;
        };
      });
      await page.goto('#/more/notes');
      await expect(page.getByText('Загружаем заметки…')).toBeVisible();
      release();
      await expect(page.getByRole('link', { name: /Учебная загрузка/ })).toHaveCount(1);
      const active = await page
        .locator('.content-motion')
        .first()
        .evaluate((node) =>
          node
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'paused')
            .map((a) => ({
              timing: a.effect?.getTiming(),
              frames: (a.effect as KeyframeEffect).getKeyframes(),
            })),
        );
      expect(active.length).toBeGreaterThan(0);
      expect(
        active.every(
          (a) =>
            a.timing?.duration === 160 &&
            !a.timing.delay &&
            a.frames.every((frame) => !frame.transform && !frame.height),
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath('loading-data-fast.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await settle(page);
      const calls = await page.evaluate(
        () => (window as unknown as { loadingCalls: number }).loadingCalls,
      );
      const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/notes');
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      await response;
      await settle(page);
      expect(
        await page.evaluate(() => (window as unknown as { loadingCalls: number }).loadingCalls),
      ).toBe(calls);
      await checkScreen(page, info, `round2-loading-${reducedMotion}`);
    });

    test('график продолжает видимую высоту при прерывании', async ({ page, family }, info) => {
      const api = await apiAs(family, 'adult');
      const object = await seedProperty(api, family, { title: 'Учебный график' });
      let value = 25;
      await page.route(`**/api/objects/${object.id}/analytics`, async (route) =>
        route.fulfill({
          json: {
            objectId: object.id,
            months: [
              {
                month: '2026-10',
                chargedCents: 100,
                paidCents: value,
                consumption: [],
                previousYear: null,
              },
            ],
          },
        }),
      );
      await signInAs(page, family, 'adult');
      await page.goto(`#/home/${object.id}`);
      await page.getByText('Аналитика объекта', { exact: true }).click();
      const bar = page.locator('.chart [data-chart-key="2026-10:1"]');
      await expect(bar).toHaveAttribute('height', '28');
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Object.assign(window, { chartFrames: [] });
        Element.prototype.animate = function (frames, options) {
          const animation = original.call(this, frames, options);
          if (this.matches('[data-chart-key]')) {
            (window as unknown as { chartFrames: unknown[] }).chartFrames.push(frames);
            animation.pause();
          }
          return animation;
        };
      });
      const refresh = async () =>
        page.evaluate(() => {
          window.dispatchEvent(new Event('offline'));
          window.dispatchEvent(new Event('online'));
        });
      value = 75;
      await refresh();
      await expect(bar).toHaveAttribute('height', '84');
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.currentTime = 80;
          });
      });
      const visible = await bar.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).height),
      );
      await page.screenshot({ path: info.outputPath('chart-interrupted.png') });
      value = 0;
      await refresh();
      await expect(bar).toHaveAttribute('height', '0');
      if (reducedMotion === 'no-preference') {
        const start = await bar.evaluate((node) =>
          Number.parseFloat(
            String((node.getAnimations()[0]?.effect as KeyframeEffect)?.getKeyframes()[0]?.height),
          ),
        );
        expect(start).toBeCloseTo(visible, 0);
      }
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((a) => a.playState === 'paused')
          .forEach((a) => {
            a.finish();
          });
      });
      await checkScreen(page, info, `round2-chart-${reducedMotion}`);
    });
  });
}
