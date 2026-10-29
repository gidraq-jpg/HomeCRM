import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import { expectAccessible, expectNoHorizontalScroll, settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

const ROWS = '.swipe-task:not([data-motion-ghost]), .task-list > li:not([data-motion-ghost])';

/** Докручивает до конца и сравнивает нижний край последней строки с сообщением и панелью. */
async function expectLastRowClear(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  const gap = await page.evaluate((selector) => {
    const rows = [...document.querySelectorAll(selector)].filter(
      (row) => row.getBoundingClientRect().height > 0,
    );
    const last = Math.max(...rows.map((row) => row.getBoundingClientRect().bottom));
    const toast = document.querySelector('.toast')?.getBoundingClientRect().top;
    const chrome = document.querySelector('.chrome__actions')?.getBoundingClientRect().top ?? 0;
    return { last, cover: Math.min(toast ?? Number.POSITIVE_INFINITY, chrome) };
  }, ROWS);
  expect(gap.last).toBeLessThanOrEqual(gap.cover + 0.5);
}

async function check(page: Page, info: TestInfo, name: string) {
  await expectAccessible(page, `D35-toast-${name}`);
  await expectNoHorizontalScroll(page);
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D35');
  await mkdir(dir, { recursive: true });
  // Снимок — конец ленты при открытом сообщении.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  await expect(page.locator('.toast')).toBeVisible();
  await page.screenshot({
    path: resolve(dir, `toast-${name}-${info.project.name}.png`),
    animations: 'disabled',
  });
}

for (const feed of ['today', 'today/plan', 'today/all']) {
  test(`UI-8: ${feed} — последняя строка докручивается из-под сообщения`, async ({
    page,
    family,
  }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    for (let index = 1; index <= 12; index++)
      await api.post('tasks', { title: `Вымышленное дело ${index}`, planOn: homeDate(0) });
    await signInAs(page, family, 'adult');
    if (feed !== 'today') await page.goto(`#/${feed}`);
    const first = page.getByRole('group', { name: 'Дело: Вымышленное дело 1', exact: true });
    await expect(first).toBeVisible();
    await expectLastRowClear(page);
    await first.getByRole('button', { name: /Выполнить|Отметить сделанным/ }).click();
    await expect(page.getByText('Дело выполнено', { exact: true })).toBeVisible();
    // Пока сообщение открыто, конец ленты докручивается выше него.
    await expectLastRowClear(page);
    await check(page, info, feed.replace('/', '-'));
  });
}

test('UI-8: покупки — последняя строка докручивается из-под сообщения', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  for (let index = 1; index <= 14; index++)
    expect(
      (
        await api.post('shopping', {
          title: `Вымышленная покупка ${index}`,
          placement: { spaceId: family.houseId, audience: 'household' },
        })
      ).status,
    ).toBe(201);
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  const first = page.getByRole('checkbox', { name: 'Вымышленная покупка 1', exact: true });
  await expect(first).toBeVisible();
  await expectLastRowClear(page);
  await first.click();
  await expect(page.locator('.toast')).toContainText('Куплено');
  await expectLastRowClear(page);
  await check(page, info, 'shopping');
});
