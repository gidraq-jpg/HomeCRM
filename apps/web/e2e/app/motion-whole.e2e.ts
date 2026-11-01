import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import { clipInsets } from '../support/clip-insets.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

async function capture(page: Page, info: TestInfo, name: string) {
  if (
    process.platform !== 'linux' ||
    info.project.name !== 'w360' ||
    name.startsWith('today-') ||
    name.startsWith('card-again-')
  )
    return;
  const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/d39');
  await mkdir(directory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await cdp.detach();
  const path = resolve(directory, `${name}.png`);
  await writeFile(path, Buffer.from(data, 'base64'));
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const reduce of [false, true]) {
  test.describe(reduce ? 'D39 reduce' : 'D39 normal', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference', isMobile: false });
    test('окно раздела, карточка, системное Назад и форма', async ({ page, family }, info) => {
      await setHomeZone(family);
      const api = await apiAs(family, 'adult');
      await api.post('tasks', { title: 'Вымышленное дело D39', planOn: homeDate(0) });
      await signInAs(page, family, 'adult');
      await settle(page);
      const cdp = await page.context().newCDPSession(page);
      if (!reduce) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.evaluate(() => {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (update) => {
          const transition = start(update);
          void transition.ready.then(() => {
            for (const animation of document.getAnimations()) {
              const effect = animation.effect as KeyframeEffect | null;
              if (!effect?.pseudoElement?.includes('view-transition')) continue;
              animation.pause();
              animation.currentTime = 0;
            }
            document.documentElement.dataset.wholePaused = 'true';
          });
          return transition;
        };
      });
      const frames = async (
        name: string,
        duration: number,
        source?: { x: number; y: number; width: number; height: number } | null,
      ) => {
        await expect(page.locator('html')).toHaveAttribute('data-whole-paused', 'true');
        const states = [];
        for (const [label, time] of [
          ['start', 0],
          ['middle', duration * 0.4],
          ['end', duration - 1],
        ] as const) {
          states.push(
            await page.evaluate((at) => {
              for (const animation of document.getAnimations())
                if (animation.playState === 'paused') animation.currentTime = at;
              const root = document.documentElement;
              const style = getComputedStyle(
                root,
                `::view-transition-${root.dataset.motionDirection === 'back' ? 'old' : 'new'}(screen)`,
              );
              return {
                clip: style.clipPath,
                transform: style.transform,
                opacity: Number(style.opacity),
                name: style.animationName,
                main: document.querySelector('.main')?.getBoundingClientRect().toJSON(),
              };
            }, time),
          );
          if (!reduce) await capture(page, info, `${name}-${label}`);
        }
        if (!reduce && source) {
          const first = states[0];
          const values = first ? clipInsets(first.clip, first.main) : [];
          expect(values.length).toBe(4);
          const main = first?.main;
          expect(Math.abs(main.x + (values?.[3] ?? 0) - source.x)).toBeLessThan(1.5);
          expect(Math.abs(main.y + (values?.[0] ?? 0) - source.y)).toBeLessThan(1.5);
          expect(Math.abs(main.right - (values?.[1] ?? 0) - source.x - source.width)).toBeLessThan(
            1.5,
          );
          expect(
            Math.abs(main.bottom - (values?.[2] ?? 0) - source.y - source.height),
          ).toBeLessThan(1.5);
        }
        if (reduce)
          for (const state of states) {
            expect(state.clip).toBe('none');
            expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(state.transform);
          }
        else if (name !== 'form') {
          expect(states[0]?.clip).toContain('inset(');
          expect(states[1]?.opacity).toBeGreaterThan(0.8);
        }
        await page.evaluate(() => {
          delete document.documentElement.dataset.wholePaused;
          for (const animation of document.getAnimations())
            if (animation.playState === 'paused') animation.finish();
        });
        await settle(page);
        await expectAccessible(page, `D39 ${name}`);
        await expectNoHorizontalScroll(page);
      };
      const source = await page
        .locator('.bottom-nav')
        .getByRole('link', { name: 'Дом', exact: true })
        .locator('.section-icon')
        .boundingBox();
      await page.locator('.bottom-nav').getByRole('link', { name: 'Дом', exact: true }).click();
      await frames('section', 450, source);
      await page.locator('.bottom-nav').getByRole('link', { name: 'Сегодня', exact: true }).click();
      await frames('today', 450);
      await page.getByRole('link', { name: 'Вымышленное дело D39', exact: true }).click();
      await frames('card', 450);
      await page.goBack();
      await frames('back', 380);
      await expect(
        page.getByRole('link', { name: 'Вымышленное дело D39', exact: true }),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Вымышленное дело D39', exact: true }).click();
      await frames('card-again', 450);
      await page.getByRole('button', { name: 'Править дело', exact: true }).click();
      await frames('form', 450);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await cdp.detach();
    });
  });
}

test.describe('D39 ленты', () => {
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
  expect(duration).toBe('1.8s');
  await page.reload();
  await settle(page);
  await page.getByText('Для проверки', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Анимации медленнее ×4' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Анимации медленнее ×4' }).uncheck();
  await expectAccessible(page, 'D39 настройка');
});
