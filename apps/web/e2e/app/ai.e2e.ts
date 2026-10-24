import { test } from '../auth/support/fixtures.ts';
import { checkApp, expect, openSection, signInAs } from './support.ts';

test('AI-3: администратор включает и выключает ИИ дома', async ({ page, family }, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/more/house', 'Настройки дома');
  const toggle = page.getByRole('switch', { name: 'Включить ИИ для дома' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await checkApp(page, info, 'ai-enabled');
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await checkApp(page, info, 'ai-disabled');
});
for (const role of ['adult', 'child'] as const)
  test(`AI-3: ${role} не меняет настройку`, async ({ page, family }) => {
    await signInAs(page, family, role);
    await openSection(page, '/more/house', 'Настройки дома');
    await expect(page.getByRole('switch', { name: 'Включить ИИ для дома' })).toHaveCount(0);
  });
