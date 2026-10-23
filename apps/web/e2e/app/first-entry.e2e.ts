import { expect, test } from '../auth/support/fixtures.ts';
import { signIn } from '../auth/support/helpers.ts';
import { checkApp } from './support.ts';

for (const role of ['adult', 'child'] as const) {
  test(`TPL-5: ${role}, первый вход один раз и второй браузер`, async ({
    page,
    family,
    browser,
  }, info) => {
    await family.database.admin.query(
      'UPDATE notification_settings SET first_entry_shown=false WHERE account_id=$1',
      [family.person(role).id],
    );
    await signIn(page, family, role);
    await expect(
      page.getByRole('heading', { name: 'Как устроены личное и общее', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('может прочитать любые незашифрованные записи.', { exact: false }),
    ).toBeVisible();
    await checkApp(page, info, `D23a-first-entry-${role}`);
    await expect
      .poll(
        async () =>
          (
            await family.database.admin.query(
              'SELECT first_entry_shown FROM notification_settings WHERE account_id=$1',
              [family.person(role).id],
            )
          ).rows[0]?.first_entry_shown,
      )
      .toBe(true);
    await page.getByRole('link', { name: 'Понятно', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    const other = await browser.newContext({ baseURL: family.baseURL });
    try {
      const second = await other.newPage();
      await signIn(second, family, role);
      await expect(second.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    } finally {
      await other.close();
    }
  });
}
test('TPL-5: прежний участник сразу видит Сегодня', async ({ page, family }) => {
  await signIn(page, family, 'adult');
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
});
test('TPL-5: уход по ссылке и закрытие страницы', async ({ page, family, browser }) => {
  await family.database.admin.query(
    'UPDATE notification_settings SET first_entry_shown=false WHERE account_id=$1',
    [family.person('child').id],
  );
  await signIn(page, family, 'child');
  await expect(
    page.getByRole('heading', { name: 'Как устроены личное и общее', exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await family.database.admin.query(
            'SELECT first_entry_shown FROM notification_settings WHERE account_id=$1',
            [family.person('child').id],
          )
        ).rows[0]?.first_entry_shown,
    )
    .toBe(true);
  await page.goto('#/more');
  await page.close();
  const context = await browser.newContext({ baseURL: family.baseURL });
  try {
    const second = await context.newPage();
    await signIn(second, family, 'child');
    await expect(second.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
