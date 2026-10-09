import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { checkApp, expect, openSection, seedProfiles, signInAs } from './support.ts';

// Состав дома, «Обо мне» и экраны администратора (R0.3b, R0.9b): SPACE-8…10, AUTH-5.
// Участники вымышленные: Анна — администратор, Борис — взрослый, Вера — ребёнок.

/** Всплывающее сообщение внизу экрана. */
const toast = (page: Page) => page.locator('.toast-region');

const members = (page: Page) => page.getByRole('list', { name: 'Участники дома' });

test('«Люди»: состав с ролями, карточка с телефоном: позвонить и скопировать', async ({
  page,
  family,
}, info) => {
  await seedProfiles(family);
  await signInAs(page, family, 'adult');
  await openSection(page, '/people', 'Люди');
  const rows = members(page).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Анна' })).toContainText('Администратор');
  await expect(rows.filter({ hasText: 'Борис (вы)' })).toContainText('Взрослый');
  await expect(rows.filter({ hasText: 'Вера' })).toContainText('Ребёнок');
  await expect(members(page).getByRole('img', { name: 'Кто видит: Вся семья' })).toHaveCount(3);
  await checkApp(page, info, 'people');

  await members(page).getByRole('link', { name: /Анна/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Анна', exact: true })).toBeVisible();
  const facts = page.getByRole('definition');
  await expect(page.getByText('17 мая 1984')).toBeVisible();
  await expect(facts.filter({ hasText: '+7 (900) 555-01-23' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Позвонить' })).toHaveAttribute(
    'href',
    'tel:+79005550123',
  );
  await page.getByRole('button', { name: 'Скопировать телефон' }).click();
  await expect(toast(page)).toContainText('Скопировано: телефон');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('+7 (900) 555-01-23');
  // У взрослого и ребёнка телефона нет: это сказано, а не скрыто.
  await checkApp(page, info, 'member');
  await page.goBack();
  await members(page).getByRole('link', { name: /Вера/ }).click();
  await expect(page.getByText('Не указан').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Позвонить' })).toHaveCount(0);
});

for (const role of ['adult', 'child'] as const) {
  test(`${role === 'adult' ? 'взрослый' : 'ребёнок'} не видит кнопок администратора`, async ({
    page,
    family,
  }) => {
    await signInAs(page, family, role);
    await openSection(page, '/people', 'Люди');
    await expect(page.getByRole('link', { name: 'Пригласить участника' })).toHaveCount(0);
    await members(page).getByRole('link', { name: /Анна/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Анна', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Для администратора' })).toHaveCount(
      0,
    );
    for (const action of ['Сменить роль', 'Исключить из дома', 'Ссылка для сброса пароля']) {
      await expect(page.getByRole('button', { name: action })).toHaveCount(0);
    }
    await openSection(page, '/people/invite', 'Приглашение');
    await expect(
      page.getByText('Пригласить нового участника в дом может только администратор'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать ссылку-приглашение' })).toHaveCount(0);
  });
}
test('«Обо мне»: просмотр и правка имени, даты рождения и телефона', async ({
  page,
  family,
}, info) => {
  await seedProfiles(family);
  await signInAs(page, family, 'adult');
  await page.getByRole('link', { name: 'Ещё', exact: true }).first().click();
  await page.getByRole('link', { name: /Обо мне/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Обо мне' })).toBeVisible();
  await expect(page.getByText('Борис', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2 нояб. 1986')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible();
  await expect(
    page.getByText('Имя, фото, дата рождения и телефон: видят все в доме.'),
  ).toBeVisible();
  await checkApp(page, info, 'profile');

  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Борис Ветров');
  await page.getByLabel('Дата рождения').fill('1986-11-03');
  await page.getByLabel('Телефон').fill('+7 (900) 555-77-88');
  await checkApp(page, info, 'profile-edit');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Профиль сохранён');
  await expect(page.getByText('3 нояб. 1986')).toBeVisible();
  await expect(page.getByRole('link', { name: '+7 (900) 555-77-88' })).toBeVisible();

  // Имя обновилось и в составе дома, и в настройках.
  await openSection(page, '/people', 'Люди');
  await expect(members(page).getByRole('link', { name: /Борис Ветров \(вы\)/ })).toBeVisible();
  const profile = await family.database.admin.query(
    'SELECT display_name, phone, birth_date::text AS birth FROM member_profiles WHERE account_id = $1',
    [family.person('adult').id],
  );
  expect(profile.rows[0]).toEqual({
    display_name: 'Борис Ветров',
    phone: '+7 (900) 555-77-88',
    birth: '1986-11-03',
  });

  // Пустое поле стирает значение: дата и телефон возвращаются в «Не указан».
  await openSection(page, '/more/profile', 'Обо мне');
  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Дата рождения').fill('');
  await page.getByLabel('Телефон').fill('');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Не указана')).toBeVisible();
  await expect(page.getByText('Не указан', { exact: true })).toBeVisible();
});

test('«Обо мне»: ошибка сохранения понятна, введённое не теряется', async ({ page, family }) => {
  await signInAs(page, family, 'child');
  await openSection(page, '/more/profile', 'Обо мне');
  await page.route('**/api/me/profile', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 400, json: { code: 'INVALID_INPUT' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Вера Ветрова');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Проверьте данные');
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Вера Ветрова');
});

test('администратор приглашает участника: ссылка видна один раз, приглашение можно отозвать', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  await page.getByRole('link', { name: 'Пригласить участника' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Пригласить участника' })).toBeVisible();
  await expect(page.getByText('Непринятых приглашений нет.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Взрослый/ })).toBeChecked();
  await page.getByRole('radio', { name: /Ребёнок/ }).check();
  await checkApp(page, info, 'invite');
  await page.getByRole('button', { name: 'Создать ссылку-приглашение' }).click();

  const link = page.getByTestId('issued-link');
  await expect(link).toContainText('/invite/');
  await expect(page.getByText('Ссылка показывается один раз.')).toBeVisible();
  await page.getByRole('button', { name: 'Скопировать', exact: true }).click();
  await expect(toast(page)).toContainText('Скопировано: ссылка-приглашение');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/invite\/[\w-]+$/);
  await expect(page.getByRole('list', { name: 'Действующие приглашения' })).toContainText(
    'Ребёнок',
  );
  await checkApp(page, info, 'invite-link');

  const stored = await family.database.admin.query('SELECT role FROM invitations');
  expect(stored.rows.map((row: { role: string }) => row.role)).toEqual(['child']);

  // Ссылку нельзя посмотреть снова: после «Создать ещё одно» её на экране нет.
  await page.getByRole('button', { name: 'Создать ещё одно приглашение' }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole('button', { name: /Отозвать приглашение: Ребёнок/ }).click();
  await expect(page.getByText('Непринятых приглашений нет.')).toBeVisible();
  const revoked = await family.database.admin.query(
    'SELECT count(*)::int AS open FROM invitations WHERE revoked_at IS NULL',
  );
  expect(revoked.rows[0]?.open).toBe(0);
});

test('администратор меняет роль; последнего администратора понизить нельзя', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  await members(page).getByRole('link', { name: /Борис/ }).click();
  await page.getByRole('button', { name: 'Сменить роль' }).click();
  const dialog = page.getByRole('dialog', { name: 'Сменить роль' });
  await expect(dialog.getByRole('button', { name: 'Сохранить роль' })).toBeDisabled();
  await dialog.getByRole('radio', { name: /Ребёнок/ }).check();
  await checkApp(page, info, 'role');
  await dialog.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect(toast(page)).toContainText('Роль изменена: Борис — Ребёнок');
  await expect(dialog).toHaveCount(0);
  await openSection(page, '/people', 'Люди');
  await expect(members(page).getByRole('listitem').filter({ hasText: 'Борис' })).toContainText(
    'Ребёнок',
  );
  const stored = await family.database.admin.query(
    'SELECT role FROM space_members WHERE account_id = $1',
    [family.person('adult').id],
  );
  expect(stored.rows[0]?.role).toBe('child');

  // Единственный администратор не может понизить себя (409 LAST_ADMIN).
  await members(page).getByRole('link', { name: /Анна/ }).click();
  await page.getByRole('button', { name: 'Сменить роль' }).click();
  await dialog.getByRole('radio', { name: /Взрослый/ }).check();
  await dialog.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'должен остаться хотя бы один администратор',
  );
  await checkApp(page, info, 'role-last-admin');
});

test('конфликт роли объяснён: ответственный за «Взрослые» не может стать ребёнком', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  await members(page).getByRole('link', { name: /Борис/ }).click();
  await page.route('**/members/*/role', (route) =>
    route.fulfill({ status: 409, json: { code: 'CONFLICT' } }),
  );
  await page.getByRole('button', { name: 'Сменить роль' }).click();
  const dialog = page.getByRole('dialog', { name: 'Сменить роль' });
  await dialog.getByRole('radio', { name: /Ребёнок/ }).check();
  await dialog.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect(dialog.getByRole('alert')).toContainText('отвечает за записи «Взрослые»');
});

test('администратор исключает участника: что останется — сказано заранее', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  await members(page).getByRole('link', { name: /Борис/ }).click();
  await page.getByRole('button', { name: 'Исключить из дома' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Исключить из дома?' });
  await expect(dialog).toContainText('остаются у самого участника');
  await expect(dialog).toContainText('бывший участник');
  await checkApp(page, info, 'exclude');
  await dialog.getByRole('button', { name: 'Исключить', exact: true }).click();
  await expect(toast(page)).toContainText('Исключён из дома: Борис');
  await expect(page.getByRole('heading', { level: 1, name: 'Люди' })).toBeVisible();
  await expect(members(page).getByRole('listitem')).toHaveCount(2);
  const former = page.getByRole('list', { name: 'Бывшие участники' });
  await expect(former).toContainText('Борис');
  await expect(former).toContainText('Бывший участник');
  await former.getByRole('link', { name: /Борис/ }).click();
  await expect(page.getByText('Бывший участник').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Для администратора' })).toHaveCount(0);
  await checkApp(page, info, 'member-former');
  // Исключение записано в составе дома; учётная запись исключённого остаётся.
  const left = await family.database.admin.query(
    'SELECT left_at IS NOT NULL AS gone FROM space_members WHERE account_id = $1',
    [family.person('adult').id],
  );
  expect(left.rows[0]?.gone).toBe(true);
});

test('исключение при отложенной передаче ответственности — успех с оговоркой', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  await members(page).getByRole('link', { name: /Вера/ }).click();
  await page.route('**/members/*/exclude', async (route) => {
    // Исключение выполняется по-настоящему, но ответ — как при сбое передачи ответственности.
    await route.fetch();
    await route.fulfill({ status: 503, json: { code: 'RESPONSIBILITY_PENDING' } });
  });
  await page.getByRole('button', { name: 'Исключить из дома' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Исключить', exact: true })
    .click();
  await expect(toast(page)).toContainText('Исключён из дома: Вера');
  await expect(toast(page)).toContainText('завершится позже сама');
  await expect(page.getByRole('list', { name: 'Бывшие участники' })).toContainText('Вера');
});

test('ссылка сброса пароля ребёнку: условия, показ один раз, копирование', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people', 'Люди');
  // Взрослому ссылку не выдать: кнопки нет.
  await members(page).getByRole('link', { name: /Борис/ }).click();
  await expect(page.getByRole('button', { name: 'Ссылка для сброса пароля' })).toHaveCount(0);
  await page.goBack();

  await members(page).getByRole('link', { name: /Вера/ }).click();
  await page.getByRole('button', { name: 'Ссылка для сброса пароля' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ссылка для сброса пароля' });
  await expect(dialog).toContainText('войти от имени ребёнка');
  await expect(dialog).toContainText('Первые 7 дней');
  await checkApp(page, info, 'reset-link-ask');
  await dialog.getByRole('button', { name: 'Выдать ссылку' }).click();
  await expect(dialog.getByTestId('issued-link')).toContainText('/reset-password?token=');
  await expect(dialog).toContainText('Ссылка показывается один раз');
  await dialog.getByRole('button', { name: 'Скопировать', exact: true }).click();
  await expect(toast(page)).toContainText('Скопировано: ссылка для сброса пароля');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '/reset-password?token=',
  );
  await checkApp(page, info, 'reset-link');
  const resets = await family.database.admin.query(
    'SELECT count(*)::int AS n FROM password_resets',
  );
  expect(resets.rows[0]?.n).toBe(1);

  // Закрыли окно — ссылку не вернуть, нужна новая.
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: 'Ссылка для сброса пароля' }).click();
  await expect(page.getByTestId('issued-link')).toHaveCount(0);
});

test('администратору без второго фактора экран объясняет, а не показывает ошибку', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  // Сервер закрыл данные из-за второго фактора уже после входа (например, его отключили).
  await openSection(page, '/people', 'Люди');
  await members(page).getByRole('link', { name: /Вера/ }).click();
  await page.route('**/members/*/password-reset', (route) =>
    route.fulfill({ status: 403, json: { code: 'SECOND_FACTOR_REQUIRED' } }),
  );
  await page.getByRole('button', { name: 'Ссылка для сброса пароля' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ссылка для сброса пароля' });
  await dialog.getByRole('button', { name: 'Выдать ссылку' }).click();
  await expect(dialog.getByText('Нужен второй фактор')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Открыть «Настройки»' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await checkApp(page, info, 'second-factor');
});

test('приглашение без второго фактора: тот же понятный текст', async ({ page, family }) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/people/invite', 'Пригласить участника');
  await page.route('**/api/invitations', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 403, json: { code: 'SECOND_FACTOR_REQUIRED' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Создать ссылку-приглашение' }).click();
  await expect(
    page.getByText('Управлять составом дома можно только со вторым фактором'),
  ).toBeVisible();
});

test('уход из дома: что останется, подтверждение, состояние после ухода', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/profile', 'Обо мне');
  await expect(page.getByText('Ваша роль в доме: Взрослый.')).toBeVisible();
  await page.getByRole('button', { name: 'Уйти из дома' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Уйти из дома?' });
  await expect(dialog).toContainText('личное пространство');
  await expect(dialog).toContainText('бывший участник');
  await expect(dialog).toContainText('Ответственность за ваши записи перейдёт администратору');
  await checkApp(page, info, 'leave');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Уйти из дома' }).click();
  await dialog.getByRole('button', { name: 'Уйти из дома' }).click();
  await expect(toast(page)).toContainText('Вы вышли из дома');
  await expect(page.getByRole('heading', { level: 1, name: 'Люди' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Вы не состоите в доме' }),
  ).toBeVisible();
  await checkApp(page, info, 'no-household');
  // Учётная запись при человеке: после перезагрузки он по-прежнему вошёл.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Вы не состоите в доме' }),
  ).toBeVisible();
  await openSection(page, '/more/profile', 'Обо мне');
  await expect(page.getByText('Вы не состоите в доме.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Уйти из дома' })).toHaveCount(0);
});

test('последний администратор не может уйти: текст говорит, что делать', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  await openSection(page, '/more/profile', 'Обо мне');
  await page.getByRole('button', { name: 'Уйти из дома' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Уйти из дома?' });
  await dialog.getByRole('button', { name: 'Уйти из дома' }).click();
  await expect(dialog.getByRole('alert')).toContainText('единственный администратор');
  await expect(dialog.getByRole('alert')).toContainText(
    'Сначала назначьте администратором другого',
  );
  await checkApp(page, info, 'leave-last-admin');
});

test('уход при отложенной передаче ответственности — успех с оговоркой', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/profile', 'Обо мне');
  await page.route('**/leave', async (route) => {
    await route.fetch();
    await route.fulfill({ status: 503, json: { code: 'RESPONSIBILITY_PENDING' } });
  });
  await page.getByRole('button', { name: 'Уйти из дома' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Уйти из дома' }).click();
  await expect(toast(page)).toContainText('Вы вышли из дома');
  await expect(toast(page)).toContainText('завершится позже сама');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Вы не состоите в доме' }),
  ).toBeVisible();
});

test('ошибка загрузки состава не ломает экран: свой повтор', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  await page.route('**/members', (route) => route.fulfill({ status: 503, json: { code: 'DOWN' } }));
  await openSection(page, '/people', 'Люди');
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Контакты' })).toBeVisible();
  await page.unroute('**/members');
  await page.getByRole('button', { name: 'Повторить загрузку участников' }).click();
  await expect(members(page).getByRole('listitem')).toHaveCount(3);
});
