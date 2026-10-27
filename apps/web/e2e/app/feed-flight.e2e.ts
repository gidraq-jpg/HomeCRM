import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import { settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

async function swipeRow(page: Page, row: Locator, dx: number) {
  const target = row.locator('a').first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing flight source');
  const width = page.viewportSize()?.width ?? 412;
  const x = dx < 0 ? Math.min(width - 35, box.x + box.width - 20) : Math.max(35, box.x + 20);
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y }],
      });
      await page.waitForTimeout(40);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

interface Sample {
  time: number;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
}
interface Observation {
  samples: Sample[];
  duration: number;
  sourceHeight?: number;
  endpoint?: Sample;
  middle?: Sample;
  target?: { x: number; y: number; width: number; height: number };
}
async function observeFlight(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as { flight: Observation };
    state.flight = { samples: [], duration: 0 };
    let pulseTarget: Element | undefined;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (this.hasAttribute('data-motion-flight')) {
        state.flight = { samples: [], duration: Number(animation.effect?.getTiming().duration) };
        // Конечную геометрию измеряем до первого paint: загруженный runner может пропустить rAF в конце.
        animation.pause();
        animation.currentTime = state.flight.duration / 2;
        const middle = this.getBoundingClientRect();
        state.flight.middle = {
          time: Number(animation.currentTime),
          opacity: Number(getComputedStyle(this).opacity),
          x: middle.x,
          y: middle.y,
          width: middle.width,
          height: middle.height,
          visible:
            middle.width > 0 &&
            middle.height > 0 &&
            middle.right > 0 &&
            middle.left < innerWidth &&
            middle.bottom > 0 &&
            middle.top < innerHeight &&
            getComputedStyle(this).visibility !== 'hidden',
        };
        animation.currentTime = state.flight.duration - 0.001;
        const end = this.getBoundingClientRect();
        state.flight.endpoint = {
          time: Number(animation.currentTime),
          opacity: Number(getComputedStyle(this).opacity),
          x: end.x,
          y: end.y,
          width: end.width,
          height: end.height,
        };
        animation.currentTime = 0;
        animation.play();
        pulseTarget = undefined;
        const record = () => {
          if (!this.isConnected) return;
          const rect = this.getBoundingClientRect();
          if (pulseTarget) {
            const target = pulseTarget.getBoundingClientRect();
            state.flight.target = {
              x: target.x,
              y: target.y,
              width: target.width,
              height: target.height,
            };
          }
          state.flight.samples.push({
            time: Number(animation.currentTime),
            opacity: Number(getComputedStyle(this).opacity),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
          requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
      } else if (
        this.matches('.swipe-task[data-motion-ghost]') &&
        this.isConnected &&
        !this.parentElement?.closest('[inert]') &&
        Array.isArray(frames) &&
        typeof frames[0]?.height === 'string'
      ) {
        state.flight.sourceHeight = Number.parseFloat(frames[0].height);
      } else if (Array.isArray(frames) && frames[1]?.transform === 'scale(1.08)') {
        pulseTarget = this;
        const rect = this.getBoundingClientRect();
        state.flight.target = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return animation;
    };
  });
}

for (const width of [412, 1440])
  test(`D32: видимый улёт по трём лентам, ${width} px`, async ({ page, family, browser }, info) => {
    test.skip(info.project.name !== 'w412', 'Запись обеих раскладок — один раз в Linux');
    test.setTimeout(120_000);
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    const routes = ['/today', '/today/plan', '/today/all'];
    const methods = ['check', 'swipe', 'trash'];
    for (let feed = 0; feed < 3; feed++)
      for (const method of methods)
        expect(
          (
            await api.post('tasks', {
              title: `Вымышленный улёт ${feed} ${method}`,
              planOn: homeDate(0),
            })
          ).status,
        ).toBe(201);
    await signInAs(page, family, 'adult');
    const dir = resolve(import.meta.dirname, '../../test-results/screens/D32/after');
    await mkdir(dir, { recursive: true });
    const context = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width, height: 915 },
      isMobile: width === 412,
      hasTouch: true,
      deviceScaleFactor: 1,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      reducedMotion: 'no-preference',
      recordVideo: { dir, size: { width, height: 915 } },
    });
    const demo = await context.newPage();
    const results: Observation[] = [];
    try {
      await demo.goto(`${family.baseURL}#/today/all`);
      await expect(demo.locator('[data-feed-ready="true"]')).toHaveCount(4);
      await observeFlight(demo);
      for (let feed = 0; feed < 3; feed++) {
        await demo.goto(`${family.baseURL}#${routes[feed]}`);
        await settle(demo);
        for (const method of methods) {
          const title = `Вымышленный улёт ${feed} ${method}`;
          const row = demo
            .locator('.swipe-task:not([data-motion-ghost])')
            .filter({ has: demo.getByRole('group', { name: `Дело: ${title}`, exact: true }) });
          await expect(row).toBeVisible();
          await row.scrollIntoViewIfNeeded();
          await settle(demo);
          await demo.evaluate(() => {
            (window as unknown as { flight: Observation }).flight = { samples: [], duration: 0 };
          });
          if (method === 'check')
            await row.getByRole('button', { name: /^(Выполнить$|Отметить сделанным:)/ }).click();
          else {
            await swipeRow(demo, row, method === 'trash' ? -80 : 80);
            await row
              .getByRole('button', {
                name: method === 'trash' ? 'В корзину' : 'Выполнено',
                exact: true,
              })
              .click();
          }
          await expect
            .poll(
              () =>
                demo.evaluate(() => (window as unknown as { flight: Observation }).flight.duration),
              { message: `${feed}: ${method} запускает улёт` },
            )
            .toBe(560);
          await expect(demo.locator('[data-motion-flight]')).toHaveCount(0);
          if (feed === 0 && method !== 'trash')
            await expect
              .poll(() =>
                demo.evaluate(
                  () => (window as unknown as { flight: Observation }).flight.sourceHeight,
                ),
              )
              .toBeGreaterThan(0);
          const flight = await demo.evaluate(
            () => (window as unknown as { flight: Observation }).flight,
          );
          expect(flight.duration).toBe(560);
          if (feed === 0 && method !== 'trash') expect(flight.sourceHeight).toBeGreaterThan(0);
          expect(flight.middle).toMatchObject({ time: 280, opacity: 1, visible: true });
          const last = flight.endpoint;
          expect(last?.time).toBeGreaterThan(480);
          expect(
            last &&
              flight.target &&
              last.x >= flight.target.x - 1 &&
              last.x + last.width <= flight.target.x + flight.target.width + 1 &&
              last.y >= flight.target.y - 1 &&
              last.y + last.height <= flight.target.y + flight.target.height + 1,
          ).toBe(true);
          expect(
            last &&
              flight.target &&
              last.x + last.width / 2 >= flight.target.x &&
              last.x + last.width / 2 <= flight.target.x + flight.target.width &&
              last.y + last.height / 2 >= flight.target.y &&
              last.y + last.height / 2 <= flight.target.y + flight.target.height,
          ).toBe(true);
          results.push(flight);
          await settle(demo);
        }
      }
    } finally {
      await context.close();
    }
    const video = resolve(dir, `flight-${width}.webm`);
    await demo.video()?.saveAs(video);
    await info.attach(`Улёт ${width} px`, { path: video, contentType: 'video/webm' });
    await info.attach(`Геометрия полётов ${width} px`, {
      body: JSON.stringify(results),
      contentType: 'application/json',
    });
  });
