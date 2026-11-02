import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AiStatus } from '@homecrm/shared';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await settle(page);
  await expectAccessible(page, `D44 ${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/d44');
    await mkdir(dir, { recursive: true });
    const path = resolve(dir, `${name}-${info.project.name}.png`);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
  }
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6 }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}
for (const reduce of [false, true])
  test.describe(reduce ? 'D44 reduce sheets' : 'D44 normal sheets', () => {
    test.use({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    test('меню закрывается вниз, фоном и историей; карточка возвращается жестом от края', async ({
      page,
      family,
    }, info) => {
      const api = await apiAs(family, 'adult');
      await api.post('tasks', {
        title: 'Вымышленный край D44',
        planOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }),
      });
      await signInAs(page, family, 'adult');
      await settle(page);
      const add = page.getByRole('button', { name: 'Добавить', exact: true }).first();
      await add.click();
      const menu = page.getByRole('dialog', { name: 'Добавить', exact: true });
      await expect(menu).toBeVisible();
      await check(page, info, `menu-${reduce}`);
      const header = await menu.locator('.sheet__header').boundingBox();
      if (!header) throw new Error('Sheet header missing');
      const height = (await menu.boundingBox())?.height ?? 600;
      await drag(page, header.x + header.width / 2, header.y + 12, 0, height * 0.4);
      await expect(menu).toHaveCount(0);
      await settle(page);
      await expect(page).toHaveURL(/#\/today$/);
      await add.click();
      await expect(menu).toBeVisible();
      await page.goBack();
      await expect(menu).toHaveCount(0);
      await settle(page);
      await expect(page).toHaveURL(/#\/today$/);
      await add.click();
      await expect(menu).toBeVisible();
      await settle(page);
      const box = await menu.boundingBox();
      if (!box) throw new Error('Sheet missing');
      await page.mouse.click(4, Math.max(2, box.y - 12));
      await expect(menu).toHaveCount(0);
      await settle(page);
      await page.getByRole('link', { name: 'Вымышленный край D44', exact: true }).click();
      await settle(page);
      const area = await page.locator('.main').boundingBox();
      if (!area) throw new Error('Card missing');
      await drag(
        page,
        5,
        Math.min((page.viewportSize()?.height ?? 740) - 160, area.y + 200),
        140,
        0,
      );
      await expect(page).toHaveURL(/#\/today$/);
      await check(page, info, `edge-return-${reduce}`);
    });
    test('медленная карточка показывает скелет до прихода данных', async ({
      page,
      family,
    }, info) => {
      const api = await apiAs(family, 'adult');
      const created = await api.post('tasks', {
        title: 'Вымышленная медленная карточка D44',
        planOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }),
      });
      expect(created.status).toBe(201);
      const { id } = created.body as { id: string };
      await signInAs(page, family, 'adult');
      await settle(page);
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let intercepted = false;
      // Контекст перехватывает и запрос service worker (Playwright 1.63).
      await page.context().route(
        (url) => url.pathname === `/api/tasks/${id}`,
        async (route) => {
          intercepted = true;
          await gate;
          await route.continue();
        },
      );
      try {
        await page
          .getByRole('link', { name: 'Вымышленная медленная карточка D44', exact: true })
          .click();
        await expect.poll(() => intercepted).toBe(true);
        await expect(
          page.getByRole('status', { name: 'Загружаем дело…', exact: true }),
        ).toBeVisible();
        await check(page, info, `cold-card-${reduce}`);
        await expect(
          page.getByRole('status', { name: 'Загружаем дело…', exact: true }),
        ).toBeVisible();
        release();
        await expect(
          page.getByRole('heading', { name: 'Вымышленная медленная карточка D44', exact: true }),
        ).toBeVisible();
        await settle(page);
      } finally {
        release();
      }
    });
    test('черновик поверх списка и правка поверх черновика: Назад закрывает один уровень', async ({
      page,
      family,
    }, info) => {
      await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
        family.houseId,
      ]);
      const api = await apiAs(family, 'adult');
      const status = AiStatus.parse((await api.get(`ai/status?spaceId=${family.houseId}`)).body);
      const id = randomUUID();
      expect(
        (
          await api.post('inbox', {
            id,
            idempotencyKey: id,
            ownerAccountId: family.person('adult').id,
            offline: true,
            source: 'text',
            text: 'Заметка: вымышленная идея D44',
            houseId: family.houseId,
            consent: null,
          })
        ).status,
      ).toBe(201);
      expect(
        (await api.post(`inbox/${id}/parse`, { consent: `v4:${status.provider}` })).status,
      ).toBe(200);
      await signInAs(page, family, 'adult');
      await page.goto('#/more/inbox');
      await settle(page);
      await page.getByRole('link', { name: 'Открыть', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Черновик', exact: true });
      await expect(preview).toBeVisible();
      await check(page, info, `draft-${reduce}`);
      await preview.getByRole('button', { name: 'Изменить', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Изменить черновик', exact: true });
      await expect(edit).toBeVisible();
      await check(page, info, `draft-edit-${reduce}`);
      await page.goBack();
      await expect(edit).toHaveCount(0);
      await expect(preview).toBeVisible();
      await settle(page);
      await page.goBack();
      await expect(preview).toHaveCount(0);
      await expect(page).toHaveURL(/#\/more\/inbox$/);
      await check(page, info, `draft-return-${reduce}`);
    });
  });
