import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { collectConsole } from './documents-support.ts';
import { apiAs, expectNothingStored, openAs, seedObject } from './notes-support.ts';
import {
  contactLinks,
  openContact,
  openPeople,
  seedInteraction,
  seedOrganization,
  seedPerson,
} from './people-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Люди и взаимодействия (R1b.2b): CONT-1…5. Семья вымышленная: Борис — взрослый, Вера — ребёнок.
// ФИО, телефоны и адреса выдуманные: ни в консоли, ни в адресе, ни в хранилищах их быть не должно.

const toast = (page: Page) => page.locator('.toast-region');
const NAME = 'Вымышленный Иван Петрович';
const PHONE_WORK = '+7 (900) 111-22-33';
const PHONE_HOME = '+7 (495) 000-11-22';
const ADDRESS = 'Вымышленная улица, дом 7';

test('человек с организацией и двумя телефонами: форма, быстрые действия, поиск и фильтр', async ({
  page,
  family,
}, info) => {
  const messages = collectConsole(page);
  const boris = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await openPeople(page);
  await expect(page.getByRole('region', { name: 'Контактов пока нет' })).toBeVisible();
  await checkApp(page, info, 'people-empty');

  const clinic = await seedOrganization(boris, {
    title: 'Вымышленная клиника',
    data: { organizationType: 'clinic' },
  });
  await openPeople(page);
  await page.getByRole('link', { name: 'Добавить человека' }).click();

  // Форма: «Кто видит» над «Сохранить»; личный контакт по умолчанию «Только я».
  const form = page.locator('form.person-form');
  await expect(page.getByRole('heading', { level: 1, name: 'Новый человек' })).toBeVisible();
  await form.getByLabel('ФИО').fill(NAME);
  await form.getByLabel('Врач', { exact: true }).check();
  await form.getByRole('button', { name: 'Добавить телефон' }).click();
  await form.getByLabel('Телефон 1: номер').fill(PHONE_WORK);
  await form.getByLabel('Телефон 1: подпись').fill('Рабочий');
  await form.getByRole('button', { name: 'Добавить телефон' }).click();
  await form.getByLabel('Телефон 2: номер').fill(PHONE_HOME);
  await form.getByLabel('Телефон 2: подпись').fill('Домашний');
  await form.getByRole('button', { name: 'Добавить почту' }).click();
  await form.getByLabel('Почта 1', { exact: true }).fill('doctor@example.test');
  await form.getByRole('button', { name: 'Добавить мессенджер' }).click();
  await form.getByLabel('Мессенджер 1: ссылка').fill('t.me/fictional_doctor');
  await form.getByLabel('Мессенджер 1: подпись').fill('Telegram');
  await form.getByLabel('Адрес').fill(ADDRESS);
  await form.getByLabel('День рождения').fill('1985-03-14');
  await form.getByLabel('Организация').selectOption({ label: 'Вымышленная клиника' });
  await expect(form.getByRole('radio', { name: /Только я/ })).toBeChecked();
  const html = await form.innerHTML();
  expect(html.indexOf('Кто видит')).toBeLessThan(html.indexOf('Сохранить'));
  await checkApp(page, info, 'person-form');

  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/api/contacts'),
  );
  await form.getByRole('button', { name: 'Сохранить' }).click();
  const body = (await request).postDataJSON() as {
    kind: string;
    organizationId: string;
    data: { categories: string[]; phones: unknown[]; birthday: string };
  };
  expect(body).toMatchObject({ kind: 'person', organizationId: clinic.id });
  expect(body.data.categories).toEqual(['doctor']);
  expect(body.data.phones).toHaveLength(2);
  expect(body.data.birthday).toBe('1985-03-14');
  await expect(page.getByRole('heading', { level: 1, name: NAME, exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Контакт — HomeCRM');

  // Быстрые действия: ссылки приходят от сервера.
  const quick = page.getByRole('navigation', { name: 'Быстрые действия' });
  await expect(quick.getByRole('link', { name: /^Позвонить/ })).toHaveAttribute(
    'href',
    'tel:+79001112233',
  );
  await expect(quick.getByRole('link', { name: 'Написать' })).toHaveAttribute(
    'href',
    'https://t.me/fictional_doctor',
  );
  await expect(quick.getByRole('link', { name: 'На карте' })).toHaveAttribute(
    'href',
    /^https:\/\/yandex\.ru\/maps\/\?text=/,
  );
  const phones = page.getByRole('list', { name: 'Телефоны' }).getByRole('listitem');
  await expect(phones).toHaveCount(2);
  await expect(phones.nth(1)).toContainText('Домашний');
  await expect(page.getByText('14 мар. 1985')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вымышленная клиника' })).toBeVisible();
  await checkApp(page, info, 'person-card');
  await expectNothingStored(page, [NAME, '111-22-33', '000-11-22', ADDRESS, 'fictional_doctor']);
  expect(messages.join('\n')).not.toContain('111-22-33');
  expect(messages.join('\n')).not.toContain(NAME);

  // Организация человека открывается своей карточкой.
  await page.getByRole('link', { name: 'Вымышленная клиника' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленная клиника', exact: true }),
  ).toBeVisible();

  // Список: поиск по ФИО и фильтр по категории живут в состоянии, а не в адресе.
  await openPeople(page);
  await expect(contactLinks(page)).toHaveCount(2);
  await page.getByLabel('Поиск по ФИО и названию').fill('петрович');
  await expect(contactLinks(page)).toHaveCount(1);
  await expect(contactLinks(page).first()).toContainText(NAME);
  expect(decodeURIComponent(page.url())).not.toContain('петрович');
  await page.getByLabel('Поиск по ФИО и названию').fill('');
  await page.getByRole('radio', { name: 'Организации' }).check();
  await expect(contactLinks(page)).toHaveCount(1);
  await expect(contactLinks(page).first()).toContainText('Вымышленная клиника');
  await page.getByRole('radio', { name: 'Врачи' }).check();
  await expect(contactLinks(page)).toHaveCount(1);
  await expect(contactLinks(page).first()).toContainText(NAME);
  await checkApp(page, info, 'people-list');
  await page.getByRole('radio', { name: 'Мастера' }).check();
  await expect(page.getByRole('region', { name: 'Ничего не нашлось' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить поиск и фильтр' }).click();
  await expect(contactLinks(page)).toHaveCount(2);
  expect(page.url()).not.toContain('?');
});

test('организация с аварийным телефоном: звонок на аварийный номер, карта, сайт', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const org = await seedOrganization(boris, {
    title: 'Вымышленная управляющая компания',
    data: {
      organizationType: 'management',
      phones: [
        { number: '+7 (800) 555-35-35', label: 'Диспетчер', emergency: false },
        { number: '+7 (495) 000-11-22', label: 'Аварийная служба', emergency: true },
      ],
      website: 'https://example.test/uk',
      address: 'Вымышленная улица, 1',
      openingHours: 'Пн–Пт 9:00–18:00',
    },
  });
  await signInAs(page, family, 'adult');
  await openPeople(page);
  await expect(contactLinks(page).first()).toContainText('Есть аварийный телефон');
  await checkApp(page, info, 'people-organization-row');

  await openContact(page, org.id, 'Вымышленная управляющая компания');
  const quick = page.getByRole('navigation', { name: 'Быстрые действия' });
  await expect(quick.getByRole('link', { name: 'Позвонить: Аварийная служба' })).toHaveAttribute(
    'href',
    'tel:+74950001122',
  );
  await expect(quick.getByRole('link', { name: 'На карте' })).toBeVisible();
  await expect(quick.getByRole('link', { name: 'Написать' })).toHaveCount(0);
  const phones = page.getByRole('list', { name: 'Телефоны' }).getByRole('listitem');
  await expect(phones).toHaveCount(2);
  await expect(phones.nth(1)).toContainText('Аварийный');
  await expect(page.getByText('Пн–Пт 9:00–18:00')).toBeVisible();
  await checkApp(page, info, 'organization-card');
});

test('связь с объектом и взаимодействие с суммой: карточка контакта, лента объекта', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира на Вымышленной',
    audience: 'household',
  });
  const master = await seedPerson(boris, {
    title: 'Вымышленный Мастер Сергей',
    data: { categories: ['craftsperson'], phones: [{ number: '+7 900 222-33-44', label: '' }] },
  });
  await signInAs(page, family, 'adult');
  await openContact(page, master.id, 'Вымышленный Мастер Сергей');
  await expect(page.getByText('Пока ни с чем не связан')).toBeVisible();

  // Связь из карточки контакта с подписью роли.
  await page.getByRole('button', { name: 'Связать с объектом…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Связать с объектом' });
  await dialog
    .getByRole('list', { name: 'Объекты, которые можно связать' })
    .getByRole('button', { name: /Квартира на Вымышленной/ })
    .click();
  await dialog.getByRole('button', { name: 'Мастер', exact: true }).click();
  await dialog.getByRole('button', { name: 'Связать', exact: true }).click();
  await expect(toast(page)).toContainText('Контакт связан с объектом');
  const objects = page.getByRole('list', { name: 'Объекты контакта' });
  await expect(objects).toContainText('Квартира на Вымышленной');
  await expect(objects).toContainText('Мастер');
  await checkApp(page, info, 'contact-objects');

  // Взаимодействие: сумма в рублях с запятой уходит копейками.
  await page.getByRole('button', { name: 'Добавить взаимодействие' }).click();
  const form = page.locator('form.event-form');
  await form.getByRole('radio', { name: 'Работа' }).check();
  await form.getByLabel('Что было').fill('Заменил смеситель на кухне');
  await form.getByLabel('Сумма, ₽ (необязательно)').fill('1 840,50');
  await form.getByRole('radio', { name: 'Да', exact: true }).check();
  await form
    .getByLabel('Объект (необязательно)')
    .selectOption({ label: 'Квартира на Вымышленной' });
  await checkApp(page, info, 'interaction-form');
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/contacts/${master.id}/interactions`),
  );
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    kind: 'work',
    amountCents: 184050,
    callAgain: true,
    objectId: flat.id,
    occurredOn: homeDate(0),
  });
  const feed = page.getByRole('list', { name: 'Взаимодействия' });
  await expect(feed).toContainText('Заменил смеситель на кухне');
  await expect(feed).toContainText(/1\s840,50\s₽/);
  await expect(feed).toContainText('Звать снова: да');
  await expect(feed.getByRole('link', { name: 'Квартира на Вымышленной' })).toBeVisible();
  await checkApp(page, info, 'contact-interactions');

  // Лента объекта показывает то же взаимодействие, блок «Люди» — контакт с подписью роли.
  await page.goto(`#/home/${flat.id}`);
  const people = page.getByRole('list', { name: 'Люди и организации' });
  await expect(people).toContainText('Вымышленный Мастер Сергей');
  await expect(people).toContainText('Мастер');
  await page.goto(`#/home/${flat.id}/timeline`);
  const timeline = page.getByRole('list', { name: 'Лента объекта' });
  await expect(timeline).toContainText('Заменил смеситель на кухне');
  await expect(timeline).toContainText(/1\s840,50\s₽/);
  await expect(timeline.getByRole('link', { name: 'Вымышленный Мастер Сергей' })).toBeVisible();
  await checkApp(page, info, 'object-timeline-interaction');

  // Правка и корзина: из ленты объекта запись пропадает вместе с корзиной.
  await openContact(page, master.id, 'Вымышленный Мастер Сергей');
  await page.getByRole('button', { name: 'Править' }).first().click();
  await expect(form.getByLabel('Сумма, ₽ (необязательно)')).toHaveValue('1840,50');
  await form.getByLabel('Сумма, ₽ (необязательно)').fill('2000');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(toast(page)).toContainText('Запись сохранена');
  await expect(feed).toContainText(/2\s000\s₽/);
  await feed.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Запись в корзине');
  await expect(feed).toHaveCount(0);
  await page.goto(`#/home/${flat.id}/timeline`);
  await expect(page.getByText('Заменил смеситель на кухне')).toHaveCount(0);
});

test('связь с человеком из карточки объекта: «Связать с человеком…»', async ({ page, family }) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Дача Вымышленная',
    audience: 'household',
  });
  await seedPerson(boris, {
    title: 'Вымышленная Соседка Мария',
    data: { categories: ['neighbor'] },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}`);
  await page.getByRole('button', { name: 'Связать с человеком…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Связать с человеком' });
  await dialog.getByRole('button', { name: /Вымышленная Соседка Мария/ }).click();
  await dialog.getByRole('button', { name: 'Сосед', exact: true }).click();
  await dialog.getByRole('button', { name: 'Связать', exact: true }).click();
  await expect(toast(page)).toContainText('Человек связан с объектом');
  const people = page.getByRole('list', { name: 'Люди и организации' });
  await expect(people).toContainText('Вымышленная Соседка Мария');
  await expect(people).toContainText('Сосед');
  await people.getByRole('link', { name: /Вымышленная Соседка Мария/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленная Соседка Мария', exact: true }),
  ).toBeVisible();
});

test('ребёнок не видит контакты и взаимодействия «Взрослых», в том числе в ленте общего объекта', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Общая квартира', audience: 'household' });
  const secret = await seedPerson(boris, {
    title: 'Вымышленный Адвокат',
    data: { categories: ['other'] },
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const open = await seedPerson(boris, {
    title: 'Вымышленная Няня',
    data: { categories: ['family'] },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await seedInteraction(boris, secret.id, {
    text: 'Консультация по вымышленному делу',
    occurredOn: homeDate(-1),
    objectId: flat.id,
  });
  await seedInteraction(boris, open.id, { text: 'Забирала из школы', occurredOn: homeDate(-1) });

  const vera = await apiAs(family, 'child');
  expect((await vera.get(`contacts/${secret.id}`)).status).toBe(404);
  expect((await vera.get(`contacts/${secret.id}/interactions`)).status).toBe(404);
  const list = (await vera.get('contacts')).body as { id: string }[];
  expect(list.map((item) => item.id)).toEqual([open.id]);
  expect(((await vera.get(`contacts/${open.id}/interactions`)).body as unknown[]).length).toBe(1);
  const feedOf = async (api: typeof vera) =>
    ((await api.get(`objects/${flat.id}/timeline`)).body as { items: { source: string }[] }).items;
  expect((await feedOf(vera)).some((item) => item.source === 'interaction')).toBe(false);
  expect((await feedOf(boris)).some((item) => item.source === 'interaction')).toBe(true);

  await signInAs(page, family, 'adult');
  await openPeople(page);
  await expect(contactLinks(page)).toHaveCount(2);

  const child = await openAs(browser, family, info, 'child');
  try {
    await openPeople(child.page);
    await expect(contactLinks(child.page)).toHaveCount(1);
    await expect(child.page.getByText('Вымышленный Адвокат')).toHaveCount(0);
    await child.page.goto(`#/people/contacts/${secret.id}`);
    await expect(child.page.getByText('больше нет, или они стали вам недоступны')).toBeVisible();
    await expect(child.page.getByText('Консультация по вымышленному делу')).toHaveCount(0);
    await child.page.goto(`#/home/${flat.id}/timeline`);
    await expect(
      child.page.getByRole('heading', { level: 1, name: 'Общая квартира' }),
    ).toBeVisible();
    await expect(child.page.getByText('Консультация по вымышленному делу')).toHaveCount(0);
    // Ребёнок читает общий контакт, но не добавляет в него записи: кнопки нет.
    await openContact(child.page, open.id, 'Вымышленная Няня');
    await expect(child.page.getByText('Забирала из школы')).toBeVisible();
    await expect(child.page.getByRole('button', { name: 'Добавить взаимодействие' })).toHaveCount(
      0,
    );
    await checkApp(child.page, info, 'contact-child');
  } finally {
    await child.close();
  }
});
