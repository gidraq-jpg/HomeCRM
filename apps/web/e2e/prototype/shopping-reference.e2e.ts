import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openApp,
  SCREENSHOT_DIR,
  screenshot,
  widthOf,
} from '../support/helpers.ts';

test('Shopping: исходная визуальная основа Claude', async ({ page }, info) => {
  await openApp(page, '/more/shopping');
  await expect(page.getByRole('heading', { level: 1, name: 'Покупки' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, 'Shopping prototype');
  if (process.platform === 'linux') {
    const dir = resolve(
      import.meta.dirname,
      '../../../../docs/screenshots/R1c.7-8',
      info.project.name,
    );
    await mkdir(dir, { recursive: true });
    await screenshot(page, info, 'shopping-prototype', 'viewport');
    await copyFile(
      resolve(SCREENSHOT_DIR, String(widthOf(info)), 'shopping-prototype.png'),
      resolve(dir, 'shopping-prototype.png'),
    );
  }
});
