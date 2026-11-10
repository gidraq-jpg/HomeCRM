import { expect, test } from '../auth/support/fixtures.ts';
import { signInAs } from './support.ts';

// D47 (UI-11): выбор темы в настройках «Оформление». Браузерные сценарии, axe и снимки —
// только в теме Studio (AGENTS.md, «Одна тема»); контраст Монохрома и iOS держит модульный
// тест токенов src/theme/theme.test.ts.
test('D47: тема выбирается в настройках и сохраняется после перезагрузки, 360 px', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Тема проверяется на 360 px.');
  await signInAs(page, family, 'adult');

  await page.goto('#/more/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'studio');

  await page.getByRole('radio', { name: /Монохром/ }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mono');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mono');

  // Возврат к Studio, чтобы не оставлять тему на устройстве после прогона.
  await page.getByRole('radio', { name: /Studio/ }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'studio');
});
