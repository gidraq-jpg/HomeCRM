import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CDPSession, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

const phase = process.env.D35_PHASE ?? 'after';

async function shot(page: Page, info: TestInfo, name: string) {
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D35');
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, `${name}-${phase}-${info.project.name}.png`),
    animations: 'disabled',
  });
}

/** Медленная протяжка вправо до доли ширины строки; палец держится, пока идёт `hold`. */
async function pull(page: Page, target: Locator, share: number, hold?: () => Promise<void>) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Gesture target is missing');
  const rowWidth = await target.evaluate(
    (node) => node.closest('.swipe-task')?.clientWidth ?? node.clientWidth,
  );
  const x = Math.max(32, box.x + 8);
  const y = box.y + Math.min(30, box.height / 2);
  const travel = rowWidth * share;
  const session: CDPSession = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (travel * step) / 10, y }],
      });
      await page.waitForTimeout(60);
    }
    await hold?.();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test.use({ reducedMotion: 'no-preference' });

test('UI-8: дело выполняет только протяжка за порог, до порога кнопка остаётся открытой', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Вымышленный порог', planOn: homeDate(0) });
  await signInAs(page, family, 'adult');
  const row = page
    .locator('.swipe-task:not([data-motion-ghost])')
    .filter({ has: page.getByRole('group', { name: 'Дело: Вымышленный порог', exact: true }) });
  const link = row.locator('a').first();
  await expect(row).toBeVisible();
  await settle(page);
  // Половина строки: раньше это уже выполняло дело, теперь только открывает кнопку.
  await pull(page, link, 0.55, async () => {
    await expect(row).not.toHaveAttribute('data-swipe-armed');
  });
  await expect(row).toHaveAttribute('data-swipe-open', 'done');
  await expect(page.getByText('Дело выполнено', { exact: true })).toHaveCount(0);
  await expectAccessible(page, 'D35-swipe-open');
  await expectNoHorizontalScroll(page);
  await shot(page, info, 'swipe-open');
  // Касание открытой строки закрывает кнопку, а не открывает карточку.
  await link.click();
  await expect(row).not.toHaveAttribute('data-swipe-open');
  await expect(page).toHaveURL(/#\/today$/);
  // За порогом строка подсвечена и подписана; отпускание выполняет дело.
  await pull(page, link, 0.85, async () => {
    await expect(row).toHaveAttribute('data-swipe-armed', 'done');
    await shot(page, info, 'swipe-armed');
  });
  await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').getByRole('button', { name: 'Отменить' })).toBeVisible();
});
