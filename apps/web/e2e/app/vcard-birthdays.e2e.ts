import { test } from '../auth/support/fixtures.ts';
import { homeDate, openRadar, recalc, setHomeZone } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { makePng } from './files-support.ts';
import { apiAs, expectNothingStored, openAs, seedObject } from './notes-support.ts';
import {
  openContact,
  openPeople,
  seedInteraction,
  seedOrganization,
  seedPerson,
} from './people-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

const toast = (page: Parameters<typeof checkApp>[0]) => page.locator('.toast-region');
const cards = [
  ['Вымышленный Друг', '+7 900 123-00-01'],
  ['Вымышленная Подруга', '+7 900 123-00-02'],
  ['Вымышленный Сосед', '+7 900 123-00-03'],
];
const content = cards
  .map(([name, phone]) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nTEL:${phone}\r\nEND:VCARD`)
  .join('\r\n');

test('vCard: три карточки, совпадение, повтор после потерянного ответа, поиск и корзина', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  await seedPerson(api, {
    title: 'Существующий Друг',
    data: { phones: [{ number: '8 (900) 123-00-01', label: 'Личный' }] },
  });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  await signInAs(page, family, 'adult');
  await openPeople(page);
  await page.getByRole('link', { name: 'Импорт из файла' }).click();
  await page
    .getByLabel('Файл контактов')
    .setInputFiles({ name: 'fictional.vcf', mimeType: 'text/vcard', buffer: Buffer.from(content) });
  await expect(
    page.getByRole('list', { name: 'Контакты из файла' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Импортировать', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Объединить: Существующий Друг' }).check();
  await checkApp(page, info, 'r1b4b-import-preview');
  const keys: string[] = [];
  let lost = false;
  await page.route('**/api/contacts/import', async (route) => {
    const body = route.request().postDataJSON();
    if (body.mode !== 'apply') {
      await route.continue();
      return;
    }
    keys.push(body.idempotencyKey);
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('тот же запрос не создаст дубли');
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByText('Добавлено 2 контакта, объединено 1')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect((await api.get('contacts')).body).toHaveLength(3);
  await expectNothingStored(page, [...cards.flat(), content]);
  for (const marker of cards.flat()) expect(messages.join('\n')).not.toContain(marker);
  await checkApp(page, info, 'r1b4b-import-result');
  await page.unroute('**/api/contacts/import');

  await page.goto('#/search');
  await page.getByLabel('Что найти').fill('Подруга');
  const found = page.getByRole('link', { name: /Вымышленная Подруга/ });
  await expect(found).toBeVisible();
  await checkApp(page, info, 'r1b4b-search-contact');
  await found.click();
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(toast(page)).toContainText('Контакт в корзине');
  await page.goto('#/more/trash');
  const deleted = page
    .getByRole('list', { name: 'Удалённые люди' })
    .getByRole('listitem')
    .filter({ hasText: 'Вымышленная Подруга' });
  await expect(deleted).toBeVisible();
  await checkApp(page, info, 'r1b4b-trash-person');
  await deleted.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Запись возвращена');
  await openPeople(page);
  await expect(page.getByRole('link', { name: /Вымышленная Подруга/ })).toBeVisible();
});

test('битый vCard: понятная ошибка, смена места требует нового предпросмотра', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/people/import');
  await page.getByLabel('Файл контактов').setInputFiles({
    name: 'broken.vcf',
    mimeType: 'text/vcard',
    buffer: Buffer.from('not a vcard'),
  });
  await expect(page.getByRole('alert')).toContainText('Не удалось прочитать vCard');
  await checkApp(page, info, 'r1b4b-import-error');
  await page
    .getByLabel('Файл контактов')
    .setInputFiles({ name: 'fictional.vcf', mimeType: 'text/vcard', buffer: Buffer.from(content) });
  await expect(page.getByRole('heading', { name: 'Предпросмотр' })).toBeVisible();
  await page.getByRole('radio', { name: 'Вся семья', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Импортировать', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Обновить предпросмотр' }).click();
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/contacts/import') && request.postDataJSON()?.mode === 'apply',
  );
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  expect((await request).postDataJSON().placement).toEqual({
    spaceId: family.houseId,
    audience: 'household',
  });
  await expect(page.getByText('Добавлено 3 контакта, объединено 0')).toBeVisible();
});

test('дни рождения с годом и без: радар, Сегодня, выключение и права ребёнка', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const birthday = `${Number(homeDate(0).slice(0, 4)) - 40}${homeDate(0).slice(4)}`;
  const known = await seedPerson(api, {
    title: 'Вымышленный Юбиляр',
    data: { birthday, birthdayEnabled: true },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await seedPerson(api, {
    title: 'Вымышленная Именинница',
    data: { birthday: `--${homeDate(1).slice(5)}`, birthdayEnabled: true },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const secret = await seedPerson(api, {
    title: 'Скрытый Именинник',
    data: { birthday, birthdayEnabled: true },
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('list', { name: 'Срочные сроки' })).toContainText(
    'Вымышленный Юбиляр',
  );
  await checkApp(page, info, 'r1b4b-birthday-today');
  await openRadar(page);
  const jubilee = page.getByRole('link', { name: /Вымышленный Юбиляр/ });
  await expect(jubilee).toContainText('исполнится 40');
  await expect(page.getByRole('link', { name: /Вымышленная Именинница/ })).not.toContainText(
    'исполнится',
  );
  await checkApp(page, info, 'r1b4b-birthday-radar');
  await jubilee.click();
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Напоминать о дне рождения' })).toBeChecked();
  await checkApp(page, info, 'r1b4b-person-birthday-form');
  await page.getByRole('checkbox', { name: 'Напоминать о дне рождения' }).uncheck();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Контакт сохранён');
  await openRadar(page);
  await expect(page.getByRole('link', { name: /Вымышленный Юбиляр/ })).toHaveCount(0);
  const child = await openAs(browser, family, info, 'child');
  try {
    await openRadar(child.page);
    await child.page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
    await expect(child.page.getByRole('link', { name: /Вымышленная Именинница/ })).toBeVisible();
    await expect(child.page.getByText('Скрытый Именинник')).toHaveCount(0);
    await openPeople(child.page);
    await expect(child.page.getByText('Скрытый Именинник')).toHaveCount(0);
    expect((await (await apiAs(family, 'child')).get(`contacts/${secret.id}`)).status).toBe(404);
    await openContact(child.page, known.id, 'Вымышленный Юбиляр');
    await checkApp(child.page, info, 'r1b4b-birthday-child');
  } finally {
    await child.close();
  }
  await expectNothingStored(page, [birthday, 'Вымышленный Юбиляр', 'Скрытый Именинник']);
});

test('Обо мне: напоминание сохраняется и открывает профиль из радара', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  await signInAs(page, family, 'adult');
  await page.goto('#/more/profile');
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByLabel('Дата рождения', { exact: true }).fill(`1986${homeDate(0).slice(4)}`);
  await page.getByRole('checkbox', { name: 'Напоминать о дне рождения' }).check();
  await checkApp(page, info, 'r1b4b-profile-birthday-form');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Профиль сохранён');
  await recalc(family);
  await openRadar(page);
  const profile = page.locator(`a[href="#/people/members/${family.person('adult').id}"]`);
  await expect(profile).toContainText('День рождения');
  await profile.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Борис', exact: true })).toBeVisible();
});

test('правка контакта и взаимодействия сохраняет скрытые связи; корзина взаимодействий', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const hidden = await seedObject(api, family, { title: 'Скрытый Объект' });
  const organization = await seedOrganization(api, { title: 'Скрытая Организация' });
  const person = await seedPerson(api, {
    title: 'Общий Контакт',
    organizationId: organization.id,
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const interaction = await seedInteraction(api, person.id, {
    text: 'Общая запись',
    occurredOn: homeDate(0),
    objectId: hidden.id,
  });
  // Личные цели Бориса становятся скрыты для администратора, который может править общий контакт.
  await api.post(`contacts/${organization.id}/move`, {
    spaceId: family.person('adult').personalSpaceId,
    confirmed: true,
  });
  await signInAs(page, family, 'admin');
  await openContact(page, person.id, 'Общий Контакт');
  await page.getByRole('button', { name: 'Править', exact: true }).last().click();
  const form = page.locator('form.person-form');
  await form.getByLabel('ФИО', { exact: true }).fill('Общий Контакт Обновлён');
  const contactRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith(`/api/contacts/${person.id}`),
  );
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await contactRequest).postDataJSON()).not.toHaveProperty('organizationId');
  await expect(toast(page)).toContainText('Контакт сохранён');
  const feed = page.getByRole('list', { name: 'Взаимодействия', exact: true });
  await feed.getByRole('button', { name: 'Править', exact: true }).click();
  const eventForm = page.locator('form.event-form');
  await eventForm.getByLabel('Что было').fill('Правка общей записи');
  const eventRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith(`/interactions/${interaction.id}`),
  );
  await eventForm.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await eventRequest).postDataJSON()).not.toHaveProperty('objectId');
  await expect(feed).toContainText('Правка общей записи');
  const stored = await family.database.admin.query(
    'SELECT object_id FROM contact_interactions WHERE id=$1',
    [interaction.id],
  );
  expect(stored.rows[0]?.object_id).toBe(hidden.id);
  const storedPerson = await family.database.admin.query(
    'SELECT organization_id FROM contacts WHERE id=$1',
    [person.id],
  );
  expect(storedPerson.rows[0]?.organization_id).toBe(organization.id);
  await feed.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Запись в корзине');
  await page.getByRole('button', { name: 'Корзина взаимодействий' }).click();
  const trash = page.getByRole('list', { name: 'Удалённые взаимодействия' });
  await expect(trash).toContainText('Правка общей записи');
  await checkApp(page, info, 'r1b4b-trash-interaction');
  await trash.getByRole('button', { name: 'Восстановить' }).click();
  await expect(feed).toContainText('Правка общей записи');
});

test('остаток начисления и отмена ровно по paymentId; месяц фильтруется по месту объекта', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const shared = await seedProperty(api, family, { title: 'Общая Квартира', audience: 'adults' });
  const privateResponse = await api.post('objects', {
    title: 'Личная Квартира',
    objectType: 'property',
  });
  expect(privateResponse.status).toBe(201);
  const personal = privateResponse.body as { id: string };
  const account = await seedAccount(api, shared.id, { title: 'Тестовый Счёт' });
  const privateAccount = await seedAccount(api, personal.id, { title: 'Личный Счёт' });
  const period = homeDate(0).slice(0, 7);
  const created = await api.post(`accounts/${account.id}/charges`, {
    period,
    totalCents: 200_000,
    dueOn: homeDate(0),
  });
  expect(created.status).toBe(201);
  const chargeId = (created.body as { id: string }).id;
  await api.post(`charges/${chargeId}/payments`, {
    paidOn: homeDate(0),
    amountCents: 15_950,
    payer: { kind: 'member', accountId: family.person('adult').id },
    method: 'card',
  });
  await api.post(`accounts/${privateAccount.id}/charges`, {
    period,
    totalCents: 50_000,
    dueOn: homeDate(10),
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  const row = page.locator('.radar-utility').filter({ hasText: 'Общая Квартира' });
  await expect(row).toContainText(/осталось 1\s840,50\s₽/);
  await checkApp(page, info, 'r1b4b-radar-remaining');
  let listRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes(`/charges/${chargeId}/payments`))
      listRequests += 1;
  });
  const markedResponse = page.waitForResponse((response) =>
    response.url().includes('/complete-payment'),
  );
  await row.getByRole('button', { name: 'Отметить оплату' }).click();
  const marked = (await (await markedResponse).json()) as { paymentId: string };
  expect(marked.paymentId).toBeTruthy();
  const cancellation = page.waitForRequest((request) =>
    request.url().endsWith(`/payments/${marked.paymentId}/cancel`),
  );
  await toast(page).getByRole('button', { name: 'Отменить', exact: true }).click();
  await cancellation;
  await expect(toast(page)).toContainText('Оплата отменена');
  expect(listRequests).toBe(0);
  await expect(row).toContainText(/осталось 1\s840,50\s₽/);
  await page.goto('#/home/month');
  const objects = page.getByRole('list', { name: 'Объекты за месяц' });
  await expect(objects).toContainText('Общая Квартира');
  await expect(objects).toContainText('Личная Квартира');
  await page.getByRole('radio', { name: 'Личное', exact: true }).check();
  await expect(objects).not.toContainText('Общая Квартира');
  await expect(objects).toContainText('Личная Квартира');
  await checkApp(page, info, 'r1b4b-month-personal');
  await page.getByRole('radio', { name: 'Общее', exact: true }).check();
  await expect(objects).toContainText('Общая Квартира');
  await expect(objects).not.toContainText('Личная Квартира');
  await checkApp(page, info, 'r1b4b-month-shared');
});

test('документы и лента используют названия и файлы из API; паспорт без даты выдачи', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, {
    title: 'Вымышленный Дом',
    audience: 'household',
  });
  const person = await seedPerson(api, {
    title: 'Вымышленный Владелец',
    data: { birthday: `${Number(homeDate(0).slice(0, 4)) - 20}${homeDate(0).slice(4)}` },
  });
  const passport = await seedDocument(api, {
    title: 'Паспорт без даты выдачи',
    type: 'russian_passport',
    owner: { kind: 'contact', id: person.id },
  });
  const contract = await seedDocument(api, {
    title: 'Договор дома',
    type: 'contract',
    owner: { kind: 'object', id: object.id },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  expect(
    (
      await api.upload(`documents/${passport.id}/files`, {
        name: 'fictional.png',
        type: 'image/png',
        data: makePng(16, 16),
      })
    ).status,
  ).toBe(201);
  await seedInteraction(api, person.id, {
    text: 'Встреча у дома',
    occurredOn: homeDate(0),
    objectId: object.id,
  });
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET') requested.push(request.url());
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/documents/${passport.id}`);
  await expect(page.getByRole('link', { name: 'Вымышленный Владелец', exact: true })).toBeVisible();
  await expect(page.locator('.expiry-note')).toContainText('20 лет');
  await expect(page.getByText('fictional.png', { exact: true })).toBeVisible();
  expect(requested.filter((url) => url.endsWith(`/documents/${passport.id}/files`))).toHaveLength(
    0,
  );
  await checkApp(page, info, 'r1b4b-document-api-files');
  await page.goto(`#/documents/${contract.id}`);
  await expect(page.getByRole('link', { name: 'Вымышленный Дом', exact: true })).toBeVisible();
  await page.goto(`#/home/${object.id}/timeline`);
  await expect(page.getByRole('list', { name: 'Лента объекта' })).toContainText('Встреча у дома');
  await expect(page.getByRole('link', { name: 'Вымышленный Владелец', exact: true })).toBeVisible();
  expect(requested.filter((url) => url.endsWith(`/contacts/${person.id}`))).toHaveLength(0);
  await checkApp(page, info, 'r1b4b-timeline-contact-title');
});

test('начисление и оплата: повтор после потерянного ответа сохраняет ключ и одну запись', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, {
    title: 'Вымышленная Квартира',
    audience: 'adults',
  });
  const account = await seedAccount(api, object.id, { title: 'Тестовый Счёт' });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/accounts/${account.id}/charges`);
  await page.getByRole('button', { name: 'Добавить начисление', exact: true }).click();
  const form = page.locator('form.charge-form');
  await form.getByLabel('Итог, ₽').fill('1840,50');
  await form.getByLabel('Срок оплаты').fill(homeDate(0));
  const keys: string[] = [];
  let lost = false;
  await page.route(`**/api/accounts/${account.id}/charges`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    keys.push(route.request().postDataJSON().idempotencyKey);
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await form.getByRole('button', { name: 'Сохранить начисление' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByRole('button', { name: 'Сохранить начисление' }).click();
  await expect(toast(page)).toContainText('Начисление сохранено');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  const charges = (await api.get(`accounts/${account.id}/charges`)).body as { id: string }[];
  expect(charges).toHaveLength(1);
  const chargeId = charges[0]?.id;
  await page.getByRole('button', { name: 'Добавить оплату', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Оплата', exact: true });
  const paymentKeys: string[] = [];
  let paymentLost = false;
  await page.route(`**/api/charges/${chargeId}/payments`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    paymentKeys.push(route.request().postDataJSON().idempotencyKey);
    const response = await route.fetch();
    if (!paymentLost) {
      paymentLost = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await sheet.getByRole('button', { name: 'Сохранить оплату' }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await sheet.getByRole('button', { name: 'Сохранить оплату' }).click();
  await expect(sheet).toHaveCount(0);
  expect(paymentKeys).toHaveLength(2);
  expect(paymentKeys[0]).toBeTruthy();
  expect(paymentKeys[0]).toBe(paymentKeys[1]);
  expect((await api.get(`charges/${chargeId}/payments`)).body).toHaveLength(1);
  await checkApp(page, info, 'r1b4b-charges-idempotent');
});
