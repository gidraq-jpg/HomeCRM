import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
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

async function capture(page: Page, info: TestInfo, name: string) {
  if (process.platform !== 'linux') return;
  const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/d44');
  await mkdir(directory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const path = resolve(directory, `${name}-${info.project.name}.png`);
    await writeFile(path, Buffer.from(data, 'base64'));
    await info.attach(name, { path, contentType: 'image/png' });
  } finally {
    await cdp.detach();
  }
}

for (const reduce of [false, true])
  test.describe(reduce ? 'D44 reduce' : 'D44 normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference', isMobile: false });
    test('раздел мгновенно, карточка сбоку, форма снизу и системный возврат', async ({
      page,
      family,
    }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленное дело D44', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await settle(page);
      await page.evaluate(() => {
        const original = document.startViewTransition.bind(document);
        document.startViewTransition = (update) => {
          const transition = original(update);
          void transition.ready.then(
            () => {
              for (const animation of document.getAnimations()) {
                if (
                  !(animation.effect as KeyframeEffect | null)?.pseudoElement?.includes(
                    'view-transition',
                  )
                )
                  continue;
                animation.pause();
                animation.currentTime = 0;
              }
              document.documentElement.dataset.d44Paused = 'true';
            },
            () => {},
          );
          return transition;
        };
      });
      const frames = async (name: string, kind: 'side' | 'back' | 'form') => {
        await expect(page.locator('html'), `D44 frame ${name}`).toHaveAttribute(
          'data-d44-paused',
          'true',
        );
        const duration = reduce ? 160 : kind === 'form' ? 300 : 330;
        const values = [];
        for (const [label, at] of [
          ['start', 0],
          ['middle', duration / 2],
          ['end', duration - 0.01],
        ] as const) {
          values.push(
            await page.evaluate((time) => {
              for (const animation of document.getAnimations())
                if (animation.playState === 'paused') animation.currentTime = time;
              const style = (which: string) =>
                getComputedStyle(document.documentElement, `::view-transition-${which}(screen)`);
              const snapshot = (which: string) => {
                const css = style(which);
                const matrix = new DOMMatrixReadOnly(
                  css.transform === 'none' ? undefined : css.transform,
                );
                return {
                  x: matrix.m41,
                  y: matrix.m42,
                  scaleX: matrix.a,
                  scaleY: matrix.d,
                  clip: css.clipPath,
                  opacity: Number(css.opacity),
                  name: css.animationName,
                };
              };
              return {
                old: snapshot('old'),
                next: snapshot('new'),
                width: document.querySelector('.main')?.getBoundingClientRect().width ?? 0,
                screenZ: Number(
                  getComputedStyle(document.documentElement, '::view-transition-group(screen)')
                    .zIndex,
                ),
                headerZ: Number(
                  getComputedStyle(document.documentElement, '::view-transition-group(header)')
                    .zIndex,
                ),
              };
            }, at),
          );
          if (!reduce) await capture(page, info, `${name}-${label}`);
        }
        for (const value of values)
          for (const item of [value.old, value.next]) {
            expect(item.clip).toBe('none');
            expect(item.scaleX).toBeCloseTo(1);
            expect(item.scaleY).toBeCloseTo(1);
            if (reduce) {
              expect(item.x).toBe(0);
              expect(item.y).toBe(0);
            }
          }
        const first = values[0];
        const middle = values[1];
        const last = values[2];
        if (!first || !middle || !last) throw new Error('Motion frame missing');
        if (reduce) {
          expect(first.next.name).toBe('motion-fade-in');
          expect(first.old.name).toBe('motion-fade-out');
        } else if (kind === 'form') {
          expect(first.next.name).toBe('motion-form-in');
          expect(first.screenZ).toBeGreaterThan(first.headerZ);
          expect(first.next.y).toBeGreaterThan(100);
          expect(middle.next.y).toBeGreaterThan(0);
          expect(last.next.y).toBeCloseTo(0, 0);
          expect(first.old.x).toBe(0);
          expect(last.old.opacity).toBe(1);
        } else if (kind === 'side') {
          expect(first.next.name).toBe('motion-side-in');
          expect(first.next.x).toBeCloseTo(first.width, 0);
          expect(middle.next.x).toBeGreaterThan(0);
          expect(last.next.x).toBeCloseTo(0, 0);
          expect(last.old.x).toBeCloseTo(-0.3 * last.width, 0);
          expect(last.old.opacity).toBeCloseTo(0.8, 2);
        } else {
          expect(first.old.name).toBe('motion-side-out');
          expect(first.next.x).toBeCloseTo(-0.3 * first.width, 0);
          expect(last.old.x).toBeCloseTo(last.width, 0);
          expect(last.next.x).toBeCloseTo(0, 0);
        }
        await page.evaluate(() => {
          delete document.documentElement.dataset.d44Paused;
          for (const animation of document.getAnimations())
            if (animation.playState === 'paused') animation.finish();
        });
        await settle(page);
        await expectAccessible(page, `D44 ${name}`);
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        if (kind === 'form') {
          await expect(page.locator('.topbar')).toBeHidden();
          await expect(page.locator('.bottom-nav')).toBeHidden();
          if (!reduce) await capture(page, info, 'form-final');
        }
      };
      await page.locator('.bottom-nav').getByRole('link', { name: 'Дом', exact: true }).click();
      await expect(page).toHaveURL(/#\/home$/);
      await settle(page);
      await expect(page.locator('html')).not.toHaveAttribute('data-d44-paused');
      await page.locator('.bottom-nav').getByRole('link', { name: 'Сегодня', exact: true }).click();
      await settle(page);
      await page.getByRole('link', { name: 'Вымышленное дело D44', exact: true }).click();
      await frames('card', 'side');
      await page.goBack();
      await frames('back', 'back');
      await page.getByRole('link', { name: 'Вымышленное дело D44', exact: true }).click();
      await frames('card-again', 'side');
      await page.getByRole('button', { name: 'Править дело', exact: true }).click();
      await frames('form', 'form');
      await page.goBack();
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
      // Локальное закрытие тоже завершается до дальнейших действий.
      await expect(page.locator('html')).toHaveAttribute('data-d44-paused', 'true');
      await page.evaluate(() => {
        delete document.documentElement.dataset.d44Paused;
        for (const a of document.getAnimations()) if (a.playState === 'paused') a.finish();
      });
      await settle(page);
      await expect(
        page.getByRole('heading', { name: 'Вымышленное дело D44', exact: true }),
      ).toBeVisible();
    });
  });

test.describe('D44: прежние ленты', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('соседняя лента едет за пальцем и сохраняет top строк после доезда', async ({
    page,
    family,
  }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    await api.post('tasks', { title: 'Вымышленная строка ленты D39', planOn: homeDate(0) });
    await signInAs(page, family, 'adult');
    await settle(page);
    const pane = page.locator('[data-feed-pane="1"]');
    await expect(pane).toHaveAttribute('data-feed-ready', 'true');
    const tops = () =>
      pane
        .locator('.plan-row')
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().top));
    await page.locator('.task-counts').scrollIntoViewIfNeeded();
    await settle(page);
    const before = await tops();
    expect(before.length).toBeGreaterThan(0);
    const box = await page.locator('.task-counts').boundingBox();
    if (!box) throw new Error('Feed gesture target is missing');
    const cdp = await page.context().newCDPSession(page);
    const x = Math.min(
      (page.viewportSize()?.width ?? 360) - 36,
      Math.max(36, box.x + box.width / 2),
    );
    const y = box.y + Math.min(24, box.height / 2);
    await capture(page, info, 'feed-start');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - i * 18, y }],
      });
      await page.waitForTimeout(40);
    }
    const shift = await page
      .locator('.feed-carousel__track')
      .evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
    expect(shift).toBeLessThan(-80);
    await capture(page, info, 'feed-middle');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page).toHaveURL(/#\/today\/plan$/);
    await settle(page);
    const after = await tops();
    expect(after.length).toBe(before.length);
    for (const [i, top] of before.entries())
      expect(Math.abs(top - (after[i] ?? 0))).toBeLessThan(1);
    await capture(page, info, 'feed-end');
    await expectAccessible(page, 'D39 лента');
    await expectNoHorizontalScroll(page);
    await cdp.detach();
  });
});

test('D39: замедление хранится локально и умножает CSS и JS-время', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/settings');
  await settle(page);
  await page.getByText('Для проверки', { exact: true }).click();
  const control = page.getByRole('checkbox', { name: 'Анимации медленнее ×4' });
  await control.check();
  expect(await page.evaluate(() => localStorage.getItem('homecrm.motion-slow'))).toBe('4');
  expect(await page.locator('html').getAttribute('data-motion-slow')).not.toBeNull();
  const duration = await page.locator('.main').evaluate((node) => {
    (node as HTMLElement).style.animationDuration = 'var(--motion-screen)';
    return getComputedStyle(node).animationDuration;
  });
  expect(duration).toBe('1.32s');
  await page.reload();
  await settle(page);
  await page.getByText('Для проверки', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Анимации медленнее ×4' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Анимации медленнее ×4' }).uncheck();
  await expectAccessible(page, 'D39 настройка');
});
