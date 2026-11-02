import { signInAs } from '../app/support.ts';
import { expect, test } from '../auth/support/fixtures.ts';

test('SHOP-3: Shift+Enter переносит строку, Enter добавляет список', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  const input = page.getByLabel('Добавить одной строкой', { exact: true });
  await input.fill('хлеб 2');
  await input.press('Shift+Enter');
  await input.pressSequentially('сыр');
  await expect(input).toHaveValue('хлеб 2\nсыр');
  await expect(page.locator('li.task-row')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.locator('li.task-row')).toHaveCount(2);
  await expect(input).toHaveValue('');
});
