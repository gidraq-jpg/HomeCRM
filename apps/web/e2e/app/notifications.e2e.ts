import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { apiAs, seedNote, seedObject } from './notes-support.ts';
import {
  ANDROID_CHROME,
  block,
  devicesList,
  fakeSubscription,
  installFakePush,
  openNotifications,
  seedAttempt,
  seedDevice,
  thisDevice,
} from './notifications-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Уведомления на телефоне (R0.7b): NOTIF-1, NOTIF-4, NOTIF-6, NOTIF-7 на готовом API R0.7. Семья
// вымышленная: Борис — взрослый, Вера — ребёнок. Подписку и разрешение подменяет installFakePush;
// push в сервис-воркере проверяется настоящим событием через протокол отладки браузера.

test.use({ userAgent: ANDROID_CHROME });

const toast = (page: Page) => page.locator('.toast-region');
const card = (page: Page) => page.getByRole('region', { name: 'Уведомления о сроках' });
const subscriptions = (family: Parameters<typeof seedAttempt>[0]) =>
  family.database.admin
    .query('SELECT account_id, device_name FROM push_subscriptions ORDER BY created_at')
    .then((result) => result.rows as { account_id: string; device_name: string }[]);

test('карточка на «Сегодня»: включить уведомления одним нажатием', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { answer: 'granted' });
  await signInAs(page, family, 'adult');

  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('Текст на экране блокировки по умолчанию скрыт');
  await checkApp(page, info, 'notif-card');

  await card(page).getByRole('button', { name: 'Включить уведомления' }).click();
  await expect(toast(page)).toContainText('Уведомления включены на этом устройстве');
  await expect(card(page)).toHaveCount(0);

  // На сервере — одно устройство Бориса с понятным названием; браузер подписан открытым ключом сервера.
  expect(await subscriptions(family)).toEqual([
    { account_id: family.person('adult').id, device_name: 'Android · Chrome' },
  ]);
  const fake = await fakeSubscription(page);
  expect(fake).toEqual({ subscribed: true, key: family.vapidPublicKey });

  // После перезагрузки карточки нет, второй подписки тоже: приложение узнаёт своё устройство.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(await subscriptions(family)).toHaveLength(1);
});

test('«Не сейчас» запоминается и не мешает; отказ в разрешении объяснён', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { answer: 'denied' });
  await signInAs(page, family, 'adult');
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'Не сейчас' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  // Отказ запоминается и на экране «Уведомления»: там можно включить и объяснено, что делать.
  await openNotifications(page);
  await expect(thisDevice(page)).toContainText('Выключено');
  await thisDevice(page).getByRole('button', { name: 'Включить на этом устройстве' }).click();
  await expect(thisDevice(page)).toContainText('Запрещено в браузере');
  await expect(thisDevice(page)).toContainText('Chrome на Android');
  await expect(thisDevice(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(
    'Уведомления запрещены в настройках браузера',
  );
  await checkApp(page, info, 'notif-denied-after-ask');
  expect(await subscriptions(family)).toEqual([]);
});

test('«Не сейчас» помнится по участнику: у второго человека в том же браузере карточка своя', async ({
  page,
  family,
}) => {
  await installFakePush(page, { answer: 'granted' });
  await signInAs(page, family, 'adult');
  await card(page).getByRole('button', { name: 'Не сейчас' }).click();
  await expect(card(page)).toHaveCount(0);

  // Тот же браузер и то же хранилище, другой участник: карточка снова на месте.
  await page.context().clearCookies();
  await page.reload();
  await signInAs(page, family, 'child');
  await expect(card(page)).toBeVisible();

  // Первый участник вернулся: его отказ сохранился.
  await page.context().clearCookies();
  await page.reload();
  await signInAs(page, family, 'adult');
  await expect(card(page)).toHaveCount(0);
});

test('открытие по #/open/<id> записи, которую участник не видит: без названия и без подсказок', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  const note = await seedNote(boris, family, { title: 'Пароли от счетов', audience: 'adults' });
  await installFakePush(page);
  await signInAs(page, family, 'child');

  for (const id of [object.id, note.id]) {
    await page.goto('#/more');
    await page.goto(`#/open/${id}`);
    await expect(page.getByText('Записи больше нет, или она стала вам недоступна.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть радар сроков' })).toBeVisible();
    // Запись есть, но «Взрослых» ребёнок не видит: ни названия, ни намёка, что она существует.
    const shown = await page.locator('body').innerText();
    expect(shown).not.toContain('Квартира у парка');
    expect(shown).not.toContain('Пароли от счетов');
    expect(page.url()).not.toContain('Квартира');
  }
  await checkApp(page, info, 'notif-open-unavailable');
});

test('карточка при отказе: сообщение и больше не появляется', async ({ page, family }) => {
  await installFakePush(page, { answer: 'denied' });
  await signInAs(page, family, 'adult');
  await card(page).getByRole('button', { name: 'Включить уведомления' }).click();
  await expect(toast(page)).toContainText('Уведомления не включены');
  await expect(toast(page)).toContainText('«Ещё» → «Уведомления»');
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('запрещено заранее: карточки нет, экран объясняет, как разрешить', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { permission: 'denied' });
  await signInAs(page, family, 'adult');
  await expect(card(page)).toHaveCount(0);
  await openNotifications(page);
  await expect(thisDevice(page)).toContainText('Запрещено в браузере');
  await expect(thisDevice(page).getByRole('listitem')).toHaveCount(3);
  await expect(thisDevice(page)).toContainText('нажмите «Включить»');
  await checkApp(page, info, 'notif-denied');
});

test('браузер без push: карточка предлагает установку, экран объясняет', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { supported: false });
  await signInAs(page, family, 'adult');
  const unsupported = page.getByRole('region', { name: 'Установите приложение на телефон' });
  await expect(unsupported).toContainText('Этот браузер не умеет присылать уведомления');
  await expect(unsupported.getByRole('button', { name: 'Включить уведомления' })).toHaveCount(0);
  await checkApp(page, info, 'notif-card-unsupported');
  await unsupported.getByRole('button', { name: 'Установить приложение' }).click();
  await expect(unsupported.getByRole('status')).toContainText('Установить приложение');

  await openNotifications(page);
  await expect(thisDevice(page)).toContainText('Не поддерживается');
  await expect(thisDevice(page)).toContainText('Chrome на Android');
  await expect(thisDevice(page).getByRole('button')).toHaveCount(0);
  await checkApp(page, info, 'notif-unsupported');
});

test('экран «Уведомления»: устройство, тихие часы, бюджет, виды и экран блокировки', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { answer: 'granted' });
  await signInAs(page, family, 'adult');
  await page.goto('#/more');
  await checkApp(page, info, 'notif-more');
  await openNotifications(page);

  // Начальное состояние: устройств нет, настройки по умолчанию (ADR-0029).
  await expect(thisDevice(page)).toContainText('Выключено');
  await expect(devicesList(page)).toHaveCount(0);
  await expect(block(page, 'Мои устройства')).toContainText('Устройств пока нет');
  await expect(page.getByLabel('С', { exact: true })).toHaveValue('22:00');
  await expect(page.getByLabel('До', { exact: true })).toHaveValue('08:00');
  await expect(page.getByLabel('Сколько уведомлений в день')).toHaveValue('5');
  await expect(page.getByRole('checkbox', { name: /Сроки записей/ })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: /Скрывать текст на экране блокировки/ }),
  ).toBeChecked();
  await expect(page.getByText('Сейчас: 22:00–8:00.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
  await checkApp(page, info, 'notif-screen-empty');

  // Включение на этом устройстве: статус, список и кнопка меняются.
  await thisDevice(page).getByRole('button', { name: 'Включить на этом устройстве' }).click();
  await expect(toast(page)).toContainText('Уведомления включены на этом устройстве');
  await expect(thisDevice(page)).toContainText('Включено');
  const item = devicesList(page).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Android · Chrome');
  await expect(item).toContainText('Это устройство');
  await expect(item).toContainText('Доставок пока не было');
  await expect(item).toContainText('Добавлено:');
  await checkApp(page, info, 'notif-screen-enabled');

  // Проверка ввода: ошибка названа, ничего не сохранено.
  const budget = page.getByLabel('Сколько уведомлений в день');
  const save = page.getByRole('button', { name: 'Сохранить настройки' });
  for (const wrong of ['', '101', 'много', '-1']) {
    await budget.fill(wrong);
    await save.click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'целое число от 0 до 100' }),
    ).toBeVisible();
  }
  await checkApp(page, info, 'notif-screen-error');

  // Новые значения сохраняются в базе и остаются после перезагрузки.
  await page.getByLabel('С', { exact: true }).fill('23:00');
  await page.getByLabel('До', { exact: true }).fill('07:30');
  await budget.fill('3');
  await expect(page.getByText('Не больше 3 уведомления в день.')).toBeVisible();
  await expect(page.getByText('Сейчас: 23:00–7:30.')).toBeVisible();
  await page.getByRole('checkbox', { name: /Скрывать текст на экране блокировки/ }).uncheck();
  await save.click();
  await expect(toast(page)).toContainText('Настройки уведомлений сохранены');
  const stored = await family.database.admin.query(
    'SELECT quiet_start, quiet_end, daily_budget, enabled_kinds, hide_text FROM notification_settings',
  );
  expect(stored.rows).toEqual([
    {
      quiet_start: '23:00',
      quiet_end: '07:30',
      daily_budget: 3,
      enabled_kinds: ['deadline'],
      hide_text: false,
    },
  ]);
  await page.reload();
  await expect(thisDevice(page)).toContainText('Включено');
  await expect(page.getByLabel('С', { exact: true })).toHaveValue('23:00');
  await expect(budget).toHaveValue('3');
  await expect(
    page.getByRole('checkbox', { name: /Скрывать текст на экране блокировки/ }),
  ).not.toBeChecked();
  await expect(save).toBeDisabled();

  // Вид уведомлений можно выключить, а равные начало и конец выключают тихие часы.
  await page.getByRole('checkbox', { name: /Сроки записей/ }).uncheck();
  await page.getByLabel('До', { exact: true }).fill('23:00');
  await expect(page.getByText('Сейчас: Тихие часы выключены.')).toBeVisible();
  await save.click();
  await expect(toast(page)).toContainText('Настройки уведомлений сохранены');
  const kinds = await family.database.admin.query(
    'SELECT quiet_end, enabled_kinds FROM notification_settings',
  );
  expect(kinds.rows).toEqual([{ quiet_end: '23:00', enabled_kinds: [] }]);
  await checkApp(page, info, 'notif-screen-saved');

  // Отключение на этом устройстве убирает запись на сервере и подписку браузера.
  await thisDevice(page).getByRole('button', { name: 'Отключить на этом устройстве' }).click();
  await expect(toast(page)).toContainText('Уведомления на этом устройстве отключены');
  await expect(thisDevice(page)).toContainText('Выключено');
  await expect(devicesList(page)).toHaveCount(0);
  expect(await subscriptions(family)).toEqual([]);
  expect((await fakeSubscription(page)).subscribed).toBe(false);
});

test('служба push не отвечает и сервер без ключей: понятные сообщения', async ({
  page,
  family,
}, info) => {
  await installFakePush(page, { answer: 'granted', subscribeFails: true });
  await signInAs(page, family, 'adult');
  await openNotifications(page);
  const enable = () =>
    thisDevice(page).getByRole('button', { name: 'Включить на этом устройстве' }).click();
  await enable();
  await expect(thisDevice(page).getByRole('alert')).toContainText('Браузер не смог подписаться');
  await checkApp(page, info, 'notif-subscribe-failed');

  await page.route('**/api/push/key', (route) =>
    route.fulfill({ status: 503, json: { code: 'PUSH_NOT_CONFIGURED' } }),
  );
  await enable();
  await expect(thisDevice(page).getByRole('alert')).toContainText('Сервер пока не настроен');
  expect(await subscriptions(family)).toEqual([]);
});

test('участник видит и отключает только свои устройства и свой журнал', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const vera = await apiAs(family, 'child');
  const borisPhone = await seedDevice(boris, 'Телефон Бориса', 'boris-phone');
  // Подписка привязана к сессии (ADR-0029): второе устройство Бориса — это второй вход.
  const borisTablet = await seedDevice(
    await apiAs(family, 'adult'),
    'Планшет Бориса',
    'boris-tablet',
  );
  const veraPhone = await seedDevice(vera, 'Телефон Веры', 'vera-phone');
  const borisId = family.person('adult').id;
  const veraId = family.person('child').id;
  await seedAttempt(family, borisId, borisPhone, { result: 'sent', minutesAgo: 30 });
  await seedAttempt(family, borisId, borisPhone, {
    result: 'retry',
    errorCode: 503,
    minutesAgo: 90,
  });
  await seedAttempt(family, borisId, borisTablet, {
    result: 'gone',
    errorCode: 410,
    minutesAgo: 150,
  });
  await seedAttempt(family, borisId, borisTablet, { result: 'uncertain', minutesAgo: 400 });
  await seedAttempt(family, veraId, veraPhone, { result: 'sent', minutesAgo: 10 });

  await installFakePush(page);
  await signInAs(page, family, 'adult');
  await openNotifications(page);

  // Только свои устройства; чужого названия нет нигде на экране.
  await expect(devicesList(page).getByRole('listitem')).toHaveCount(2);
  await expect(devicesList(page)).toContainText('Телефон Бориса');
  await expect(devicesList(page)).toContainText('Планшет Бориса');
  expect(await page.locator('main').innerText()).not.toContain('Телефон Веры');
  await checkApp(page, info, 'notif-devices');

  // Журнал: четыре своих попытки, у каждой время, вид, устройство и итог словами.
  await page.getByRole('link', { name: /^Журнал доставки/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал доставки' })).toBeVisible();
  const rows = page.getByRole('list', { name: 'Попытки отправки' }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Сроки записей');
  await expect(rows.nth(0)).toContainText('Телефон Бориса');
  await expect(rows.nth(0)).toContainText('Принято службой push');
  await expect(rows.nth(1)).toContainText('Ошибка, повторим (код 503)');
  await expect(rows.nth(2)).toContainText('Планшет Бориса');
  await expect(rows.nth(2)).toContainText('Устройство отключено службой (код 410)');
  await expect(rows.nth(3)).toContainText('Результат неизвестен');
  expect(await page.locator('main').innerText()).not.toContain('Веры');
  await checkApp(page, info, 'notif-log');
  const api = await boris.get('notifications/deliveries');
  expect((api.body as unknown[]).length).toBe(4);

  // Чужое устройство не отключить: сервер отвечает «нет такого», как будто его не существует.
  const foreign = await page.evaluate(
    async (id) => (await fetch(`/api/push/subscriptions/${id}`, { method: 'DELETE' })).status,
    veraPhone,
  );
  expect([403, 404]).toContain(foreign);
  expect(await subscriptions(family)).toHaveLength(3);

  // Своё — отключается кнопкой, чужое остаётся нетронутым.
  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Уведомления', exact: true }),
  ).toBeVisible();
  await devicesList(page)
    .getByRole('button', { name: 'Отключить устройство: Планшет Бориса' })
    .click();
  await expect(toast(page)).toContainText('Устройство отключено');
  await expect(devicesList(page).getByRole('listitem')).toHaveCount(1);
  await expect(devicesList(page)).not.toContainText('Планшет Бориса');
  expect((await subscriptions(family)).map((row) => row.device_name).sort()).toEqual([
    'Телефон Бориса',
    'Телефон Веры',
  ]);

  // В журнале отключённое устройство остаётся без названия.
  await page.getByRole('link', { name: /^Журнал доставки/ }).click();
  await expect(rows.nth(2)).toContainText('Отключённое устройство');
  await checkApp(page, info, 'notif-log-removed-device');
});

test('журнал без попыток: пояснение вместо пустой страницы', async ({ page, family }, info) => {
  await installFakePush(page);
  await signInAs(page, family, 'child');
  await page.goto('#/more/notifications/log');
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал доставки' })).toBeVisible();
  await expect(page.getByText('Попыток отправки пока не было.')).toBeVisible();
  await checkApp(page, info, 'notif-log-empty');
});
