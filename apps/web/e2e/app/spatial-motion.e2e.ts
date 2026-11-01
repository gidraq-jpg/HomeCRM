import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { clipInsets as insets } from '../support/clip-insets.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

/** Снимок только сдвигается: масштаба нет совсем, тем более неравномерного. */
function unscaled(transform: string) {
  if (transform === 'none') return true;
  const match = /^matrix\(([^)]*)\)$/.exec(transform);
  const [a, b, c, d] = (match?.[1] ?? '').split(',').map(Number.parseFloat);
  return Math.abs((a ?? 0) - (d ?? 0)) < 0.001 && b === 0 && c === 0;
}

test.describe('D38: окно раскрытия', () => {
  test.use({ reducedMotion: 'no-preference', isMobile: false });
  test('UI-8: карточка открывается окном от строки, без растяжения снимка', async ({
    page,
    family,
  }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    for (let n = 0; n < 12; n++)
      await api.post('tasks', {
        title: `Вымышленное окно ${String(n).padStart(2, '0')}`,
        planOn: homeDate(0),
      });
    await signInAs(page, family, 'adult');
    await settle(page);
    // Переход замирает на первом кадре: кадры снимаются вручную.
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (update) => {
        const transition = start(
          typeof update === 'function'
            ? async () => {
                await update();
                if (document.documentElement.dataset.motionDirection !== 'forward') return;
                const main = document.querySelector<HTMLElement>('.main');
                // Детерминированная догрузка после callback и до снимка: маска не зависит от новой высоты.
                if (main) main.style.minHeight = `${main.getBoundingClientRect().height + 180}px`;
              }
            : update,
        );
        void transition.ready.then(
          () => {
            if (document.documentElement.dataset.motionDirection === 'back') return;
            for (const animation of document.getAnimations()) {
              if (animation.effect?.getTiming().iterations === Infinity) continue;
              animation.pause();
              animation.currentTime = 0;
            }
            document.documentElement.dataset.cardPaused = 'true';
          },
          () => {},
        );
        return transition;
      };
    });
    const link = page.getByRole('link', { name: 'Вымышленное окно 06', exact: true });
    const open = async () => {
      await link.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await settle(page);
      const box = await link.boundingBox();
      await page.evaluate(() => delete document.documentElement.dataset.cardPaused);
      await link.click();
      await expect(page.locator('html')).toHaveAttribute('data-card-paused', 'true');
      return box;
    };
    const frame = (time: number) =>
      page.evaluate((at) => {
        for (const animation of document.getAnimations())
          if (animation.playState === 'paused') animation.currentTime = at;
        const root = document.documentElement;
        const next = getComputedStyle(root, '::view-transition-new(screen)');
        const old = getComputedStyle(root, '::view-transition-old(screen)');
        const box = document.querySelector('.main')?.getBoundingClientRect();
        const group = getComputedStyle(root, '::view-transition-group(screen)');
        const snapshotHeight = Number.parseFloat(
          next.height.endsWith('px') ? next.height : group.height,
        );
        const snapshotWidth = Number.parseFloat(
          next.width.endsWith('px') ? next.width : group.width,
        );
        return {
          clip: next.clipPath,
          transform: next.transform,
          opacity: Number(next.opacity),
          oldOpacity: Number(old.opacity),
          oldTransform: old.transform,
          duration: next.animationDuration,
          main: box
            ? {
                x: box.x,
                y: box.y,
                right: box.x + snapshotWidth,
                width: snapshotWidth,
                height: snapshotHeight,
                bottom: box.y + snapshotHeight,
              }
            : undefined,
        };
      }, time);
    const finish = async () => {
      await page.evaluate(() => {
        for (const animation of document.getAnimations())
          if (animation.playState === 'paused') animation.play();
      });
      await expect(
        page.getByRole('heading', { level: 1, name: 'Вымышленное окно 06' }),
      ).toBeVisible();
      await page
        .locator('.main')
        .evaluate((node) => (node as HTMLElement).style.removeProperty('min-height'));
      await settle(page);
    };
    const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/d38');
    const screens = process.platform === 'linux' && info.project.name === 'w360';
    // Снимок экрана завершает View Transition, поэтому каждый кадр — отдельное открытие.
    const shoot = async (name: string) => {
      await mkdir(dir, { recursive: true });
      const path = resolve(dir, `${name}.png`);
      // page.screenshot сначала завершает переход; CDP снимает текущий кадр как есть.
      const session = await page.context().newCDPSession(page);
      try {
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path, Buffer.from(data, 'base64'));
      } finally {
        await session.detach();
      }
      await info.attach(name, { path, contentType: 'image/png' });
    };

    const row = await open();
    const first = await frame(0);
    expect(first.duration).toBe('0.45s');
    expect(first.transform).toBe('none');
    expect(first.opacity).toBeLessThan(0.05);
    const [top, right, bottom, left] = insets(first.clip, first.main);
    const main = first.main ?? { x: 0, y: 0, right: 0, bottom: 0 };
    expect(Math.abs(main.y + top - (row?.y ?? 0))).toBeLessThan(1.5);
    expect(Math.abs(main.x + left - (row?.x ?? 0))).toBeLessThan(1.5);
    expect(Math.abs(main.right - right - ((row?.x ?? 0) + (row?.width ?? 0)))).toBeLessThan(1.5);
    expect(Math.abs(main.bottom - bottom - ((row?.y ?? 0) + (row?.height ?? 0)))).toBeLessThan(1.5);
    expect(unscaled(first.oldTransform)).toBe(true);
    const middle = await frame(240);
    expect(middle.transform).toBe('none');
    expect(middle.opacity).toBeGreaterThan(0.8);
    expect(middle.oldOpacity).toBeGreaterThan(0.3);
    const [midTop] = insets(middle.clip, middle.main);
    expect(midTop).toBeLessThan(top);
    const last = await frame(449);
    expect(last.transform).toBe('none');
    expect(insets(last.clip, last.main).every((value) => value < 2)).toBe(true);
    // Данные карточки приходят во время раскрытия и не обрывают его.
    await expect(page.locator('.main h1')).toHaveText('Вымышленное окно 06');
    await page.waitForTimeout(100);
    await expect(page.locator('html')).toHaveAttribute('data-motion-direction', 'forward');
    await finish();

    if (screens)
      for (const [name, time] of [
        ['card-start-w360', 130],
        ['card-middle-w360', 260],
      ] as const) {
        // Системный «Назад» не перехватывается: список возвращается без перехода.
        await page.goBack();
        await settle(page);
        await open();
        await expect(page.locator('.main h1')).toHaveText('Вымышленное окно 06');
        await frame(time);
        await shoot(name);
        await finish();
      }
    if (screens) await shoot('card-end-w360');
    await expectAccessible(page, 'D38 карточка после раскрытия');
    await expectNoHorizontalScroll(page);
  });
});

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
      expect(motion.card).toBe('forward');
      expect(motion.next).toBe(reduce ? 'motion-fade-in' : 'motion-card-in');
      expect(motion.geometry).toContain('inset(');
      expect(motion.nextTransform).toBe('none');
      expect(unscaled(motion.oldTransform)).toBe(true);
      if (reduce) {
        // «Уменьшить движение»: только прозрачность, без окна и сдвигов.
        expect(motion.nextClip).toBe('none');
        expect(motion.oldClip).toBe('none');
      } else {
        const [top, right, bottom, left] = insets(motion.nextClip, {
          width: motion.main.right - motion.main.x,
          height: motion.main.bottom - motion.main.y,
        });
        const main = motion.main;
        expect(Math.abs(main.y + top - (row?.y ?? 0))).toBeLessThan(1.5);
        expect(Math.abs(main.x + left - (row?.x ?? 0))).toBeLessThan(1.5);
        expect(Math.abs(main.right - right - ((row?.x ?? 0) + (row?.width ?? 0)))).toBeLessThan(
          1.5,
        );
        expect(Math.abs(main.bottom - bottom - ((row?.y ?? 0) + (row?.height ?? 0)))).toBeLessThan(
          1.5,
        );
      }
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
      expect(unscaled(back.oldTransform)).toBe(true);
      if (reduce) expect(back.oldClip).toBe('none');
      else expect(insets(back.oldClip)).toEqual([0, 0, 0, 0]);
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
