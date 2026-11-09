import { expect, test } from '../auth/support/fixtures.ts';
import { checkScreen, settle } from '../support/helpers.ts';
import { homeDate } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test.use({ video: 'on' });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`motion-template-${reducedMotion}`, () => {
    test.use({ reducedMotion });
    test('UI-8: локальная смена, одинаковый ключ, прерывание и пустое состояние', async ({
      page,
      family,
    }, info) => {
      const api = await apiAs(family, 'adult');
      for (let i = 0; i < 8; i++) {
        const result = await api.post('tasks', {
          title: `Учебное дело ${i}`,
          status: i < 4 ? 'open' : 'done',
        });
        expect(result.status).toBe(201);
      }
      await signInAs(page, family, 'adult');
      await page.goto('#/today/all');
      await page.getByRole('button', { name: /^Фильтры/ }).click();
      const status = page
        .getByRole('dialog', { name: 'Фильтры дел', exact: true })
        .getByLabel('Статус дел', { exact: true });
      await status.selectOption('open');
      await settle(page);
      await expect(
        page.locator('[data-feed-active="true"] .content-motion li[data-motion-key]'),
      ).toHaveCount(4);
      // Отслеживаем запуск до серверного ответа: ключ результата меняется только после новых данных.
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Object.assign(window, { motionCalls: [], motionPause: true });
        Element.prototype.animate = function (frames, options) {
          if (this.closest('.content-motion'))
            (window as unknown as { motionCalls: unknown[] }).motionCalls.push({ frames, options });
          const animation = original.call(this, frames, options);
          if (
            this.closest('.content-motion') &&
            (window as unknown as { motionPause: boolean }).motionPause
          )
            animation.pause();
          return animation;
        };
      });
      await status.selectOption('done');
      await expect(
        page.locator('[data-feed-active="true"] .content-motion > [data-motion-ghost]'),
      ).toHaveCount(1);
      const ghost = page.locator('[data-feed-active="true"] .content-motion > [data-motion-ghost]');
      await expect(ghost).toHaveAttribute('aria-hidden', 'true');
      expect(await ghost.evaluate((node) => (node as HTMLElement).inert)).toBe(true);
      await page.screenshot({ path: info.outputPath('transition-start.png') });
      await page.evaluate(() => {
        document
          .getAnimations()
          .filter((animation) => animation.playState === 'paused')
          .forEach((animation) => {
            animation.currentTime = 80;
          });
      });
      await page.screenshot({ path: info.outputPath('transition-middle.png') });
      const beforeRapid = await ghost.evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        opacity: Number(getComputedStyle(node).opacity),
      }));
      await status.selectOption('open');
      const afterRapid = await ghost.evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        opacity: Number(getComputedStyle(node).opacity),
      }));
      expect(afterRapid.left).toBeCloseTo(beforeRapid.left, 1);
      expect(afterRapid.opacity).toBeCloseTo(beforeRapid.opacity, 2);
      await status.selectOption('done');

      if (reducedMotion === 'reduce') {
        const calls = await page.evaluate(
          () =>
            (
              window as unknown as {
                motionCalls: {
                  frames: Record<string, unknown>[];
                  options: KeyframeAnimationOptions;
                }[];
              }
            ).motionCalls,
        );
        expect(calls.every((call) => call.frames.every((frame) => !('transform' in frame)))).toBe(
          true,
        );
        expect(calls.every((call) => !call.options.delay)).toBe(true);
      }
      await page.evaluate(() => {
        Object.assign(window, { motionPause: false });
        document
          .getAnimations()
          .filter((animation) => animation.playState === 'paused')
          .forEach((animation) => {
            animation.play();
          });
      });
      await settle(page);
      await expect(
        page.locator('[data-feed-active="true"] .content-motion > [data-motion-ghost]'),
      ).toHaveCount(0);
      const calls = await page.evaluate(
        () => (window as unknown as { motionCalls: unknown[] }).motionCalls.length,
      );
      // Повторный выбор не меняет данные и не перезапускает рисунок.
      await status.selectOption('done');
      await page.waitForTimeout(100);
      expect(
        await page.evaluate(
          () => (window as unknown as { motionCalls: unknown[] }).motionCalls.length,
        ),
      ).toBe(calls);
      await status.selectOption('open');
      await status.selectOption('done');
      await status.selectOption('cancelled');
      await expect(page.getByText('Дел под выбранные условия нет.')).toBeVisible();
      await settle(page);
      await expect(
        page.locator('[data-feed-active="true"] .content-motion [data-motion-ghost]'),
      ).toHaveCount(0);
      await checkScreen(page, info, `motion-template-empty-${reducedMotion}`);
      await status.selectOption('open');
      await checkScreen(page, info, `motion-template-list-${reducedMotion}`);
      // Длинный список не обрезается новым коротким состоянием до окончания выхода.
      await page.evaluate(() => {
        Object.assign(window, { motionPause: true });
      });
      await status.selectOption('cancelled');
      const leaving = page.locator(
        '[data-feed-active="true"] .content-motion > [data-motion-ghost]',
      );
      await expect(leaving).toHaveCount(1);
      const geometry = await leaving.evaluate((node) => ({
        old: node.getBoundingClientRect().height,
        host: node.parentElement?.getBoundingClientRect().height ?? 0,
      }));
      expect(geometry.host).toBeGreaterThanOrEqual(geometry.old - 1);
      await page.screenshot({
        path: info.outputPath('list-to-empty-preserved.png'),
        fullPage: true,
      });
      // Новая цель отменяет предыдущий выход; его microtask не снимает высоту нового снимка.
      await status.selectOption('done');
      await status.selectOption('cancelled');
      await expect(leaving).toHaveCount(1);
      await page.waitForTimeout(0);
      const interrupted = await leaving.evaluate((node) => ({
        old: node.getBoundingClientRect().height,
        host: node.parentElement?.getBoundingClientRect().height ?? 0,
      }));
      expect(interrupted.host).toBeGreaterThanOrEqual(interrupted.old - 1);
      await page.evaluate(() => {
        Object.assign(window, { motionPause: false });
        document
          .getAnimations()
          .filter((animation) => animation.playState === 'paused')
          .forEach((animation) => {
            animation.play();
          });
      });
      await settle(page);
      // RowList сохраняет предметный ключ SwipeTaskRow: иначе flyTask не находит исходную строку.
      const seeded = await api.post('tasks', { title: 'Учебный улёт', planOn: homeDate(0) });
      expect(seeded.status).toBe(201);
      const id = (seeded.body as { id: string }).id;
      await page.goto('#/today');
      await page.reload();
      await expect(
        page.locator(`[data-feed-active="true"] [data-motion-key="${id}"]`),
      ).toBeVisible();
      await page.goto('#/documents');
      await checkScreen(page, info, `motion-template-documents-${reducedMotion}`);
      await page.goto('#/home');
      await checkScreen(page, info, `motion-template-objects-${reducedMotion}`);
    });
  });
}
