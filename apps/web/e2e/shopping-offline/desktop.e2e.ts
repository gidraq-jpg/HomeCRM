import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiAs } from '../app/notes-support.ts';
import { signInAs } from '../app/support.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';

test('SHOP/OFFLINE desktop: реальные данные, длинный текст, редактор и каркас', async ({
  page,
  family,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await api.post('shopping', {
    title: 'Очень длинное название нужной покупки для вымышленной семьи '.repeat(3),
    quantity: 'Семь упаковок для недели',
    data: {
      note: 'Длинная заметка о покупке. '.repeat(100),
      store: 'Магазин у остановки',
      category: 'Для всей семьи',
    },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  await expect(page.getByRole('link', { name: /Очень длинное название/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, 'Shopping desktop');
  const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/R1c.7-8/desktop');
  await mkdir(dir, { recursive: true });
  if (process.platform === 'linux')
    await page.screenshot({ path: resolve(dir, 'shopping-real-long.png'), fullPage: true });
  await page.getByRole('link', { name: /Очень длинное название/ }).click();
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await settle(page);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, 'Shopping editor desktop');
  if (process.platform === 'linux')
    await page.screenshot({ path: resolve(dir, 'shopping-editor.png') });
});
