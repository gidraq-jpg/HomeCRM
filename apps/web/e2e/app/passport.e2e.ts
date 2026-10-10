import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { documentLinks, openDocuments, seedDocument } from './documents-support.ts';
import { apiAs, openAs } from './notes-support.ts';
import { openContact, seedPerson } from './people-support.ts';
import { checkApp, expect, seedProfiles, signInAs } from './support.ts';

// Сроки документов и паспорт РФ (R1b.2b): DOC-3, DOC-4. Даты рождения вымышленные: Борис родился
// 2 ноября 1986 года (seedProfiles), поэтому его 45 лет — 2 ноября 2031, а окно замены — 90 дней.

const toast = (page: Page) => page.locator('.toast-region');
const note = (page: Page) => page.locator('.expiry-note');

test('паспорт с вычисленным сроком по дате рождения владельца и с явным сроком', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  await seedProfiles(family);
  const boris = await apiAs(family, 'adult');
  const me = { kind: 'member' as const, id: family.person('adult').id };
  const computed = await seedDocument(boris, {
    title: 'Паспорт Бориса',
    type: 'russian_passport',
    issuedOn: '2006-12-01',
    owner: me,
  });
  const explicit = await seedDocument(boris, {
    title: 'Паспорт Бориса с явным сроком',
    type: 'russian_passport',
    issuedOn: '2006-12-01',
    expiresOn: '2031-06-01',
    owner: me,
  });
  await signInAs(page, family, 'adult');

  // Вычисленный срок: окно замены с 45-летия и 90 дней на замену.
  await page.goto(`#/documents/${computed.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Паспорт Бориса' })).toBeVisible();
  await expect(note(page)).toContainText(/Срок по возрасту: до 31\sянв\.\s2032\s— 45 лет/);
  await expect(note(page)).toContainText('Замена с 2 нояб. 2031');
  await expect(page.getByText(/вычислен по возрасту/)).toBeVisible();
  await expect(page.getByText('Срок не указан')).toHaveCount(0);
  await checkApp(page, info, 'passport-computed');

  // Явный срок важнее вычисленного: пояснения про возраст нет.
  await page.goto(`#/documents/${explicit.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Паспорт Бориса с явным сроком' }),
  ).toBeVisible();
  await expect(note(page)).toHaveCount(0);
  await expect(page.getByText(/до 1\sиюн\.\s2031/).first()).toBeVisible();
  await checkApp(page, info, 'passport-explicit');

  // В списке у вычисленного срока свой статус со словами.
  await openDocuments(page);
  await expect(documentLinks(page)).toHaveCount(2);
  await expect(documentLinks(page).filter({ hasText: 'Паспорт Бориса' }).first()).toBeVisible();
});

test('без даты рождения владельца: подсказка, затем срок появляется после ввода даты', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const neighbour = await seedPerson(boris, {
    title: 'Вымышленная Соседка Анастасия',
    data: { categories: ['neighbor'] },
  });
  const passport = await seedDocument(boris, {
    title: 'Паспорт соседки',
    type: 'russian_passport',
    issuedOn: '2020-01-01',
    owner: { kind: 'contact', id: neighbour.id },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/documents/${passport.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Паспорт соседки' })).toBeVisible();
  await expect(note(page)).toContainText('Срок пока не вычислен');
  await expect(note(page)).toContainText('Укажите дату рождения владельца');
  await expect(page.getByText('Вычислится по дате рождения', { exact: true })).toBeVisible();
  await checkApp(page, info, 'passport-pending');
  await openDocuments(page);
  await expect(documentLinks(page).first()).toContainText('Срок вычислится по дате рождения');

  // Дата рождения вводится в карточке контакта-владельца.
  await page.goto(`#/documents/${passport.id}`);
  await note(page).getByRole('link', { name: 'Открыть контакт' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленная Соседка Анастасия' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('День рождения').fill('2006-12-01');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(toast(page)).toContainText('Контакт сохранён');

  await page.goto(`#/documents/${passport.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Паспорт соседки' })).toBeVisible();
  await expect(note(page)).toContainText(/Срок по возрасту: до 1\sмар\.\s2027\s— 20 лет/);
  await expect(note(page)).not.toContainText('Укажите дату рождения');
  await checkApp(page, info, 'passport-after-birthday');
});

test('ребёнок не видит вычисленный срок, если дата рождения ему не видна', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  // Дата рождения у контакта «Взрослых»: общий паспорт не может её использовать и ждёт данные
  // у всех читателей, чтобы дата не раскрылась ребёнку через срок.
  const hidden = await seedPerson(boris, {
    title: 'Вымышленный Закрытый Владелец',
    data: { categories: ['other'], birthday: '2006-12-01' },
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const closed = await seedDocument(boris, {
    title: 'Общий паспорт закрытого владельца',
    type: 'russian_passport',
    issuedOn: '2020-01-01',
    owner: { kind: 'contact', id: hidden.id },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  // Контакт «Вся семья» виден ребёнку, поэтому срок по его дате рождения виден всем.
  const open = await seedPerson(boris, {
    title: 'Вымышленная Общая Владелица',
    data: { categories: ['family'], birthday: '2006-12-01' },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const visible = await seedDocument(boris, {
    title: 'Общий паспорт открытой владелицы',
    type: 'russian_passport',
    issuedOn: '2020-01-01',
    owner: { kind: 'contact', id: open.id },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/documents/${visible.id}`);
  await expect(note(page)).toContainText(/до 1\sмар\.\s2027\s— 20 лет/);
  await page.goto(`#/documents/${closed.id}`);
  await expect(note(page)).toContainText('Укажите дату рождения владельца');

  const child = await openAs(browser, family, info, 'child');
  try {
    await child.page.goto(`#/documents/${closed.id}`);
    await expect(
      child.page.getByRole('heading', { level: 1, name: 'Общий паспорт закрытого владельца' }),
    ).toBeVisible();
    await expect(note(child.page)).toContainText('Укажите дату рождения владельца');
    // Ни вычисленной даты, ни года из неё, ни ссылки на закрытый контакт.
    await expect(child.page.locator('main')).not.toContainText(/2027/);
    await expect(child.page.locator('main')).not.toContainText('Срок по возрасту');
    await expect(child.page.getByText('Вымышленный Закрытый Владелец')).toHaveCount(0);
    await checkApp(child.page, info, 'passport-child');
    const vera = await apiAs(family, 'child');
    const card = await vera.get(`documents/${closed.id}`);
    expect(JSON.stringify(card.body)).not.toContain('2026-12-01');
    expect((await vera.get(`contacts/${hidden.id}`)).status).toBe(404);

    // Открытая дата рождения видна и ребёнку: срок вычислен для всех читателей.
    await child.page.goto(`#/documents/${visible.id}`);
    await expect(note(child.page)).toContainText(/до 1\sмар\.\s2027\s— 20 лет/);
  } finally {
    await child.close();
  }
});
test('предупреждения о сроке: по умолчанию из типа, свои, «не предупреждать», возврат к типу', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const doc = await seedDocument(boris, {
    title: 'ОСАГО Вымышленное',
    type: 'osago',
    expiresOn: homeDate(200),
    owner: { kind: 'member', id: family.person('adult').id },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/documents/${doc.id}`);
  const row = page.locator('.facts__item').filter({ hasText: 'Предупреждения' });
  await expect(row).toContainText('за 30, 14 и 3 дня');
  await expect(row).toContainText('по умолчанию для типа');

  await row.getByRole('button', { name: 'Изменить предупреждения' }).click();
  await row.getByLabel('Предупреждать за, дней').fill('45, 10');
  await checkApp(page, info, 'document-warnings-edit');
  await row.getByRole('button', { name: 'Сохранить' }).click();
  await expect(toast(page)).toContainText('Предупреждения сохранены');
  await expect(row).toContainText('за 45 и 10 дней');
  await expect(row).toContainText('(свои)');
  let stored = (await boris.get(`documents/${doc.id}`)).body as {
    warnings: number[];
    data: { warnings?: number[] };
  };
  expect(stored.warnings).toEqual([45, 10]);

  await row.getByRole('button', { name: 'Изменить предупреждения' }).click();
  await row.getByRole('checkbox', { name: 'Не предупреждать' }).check();
  await row.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  await expect(row).toContainText('Не предупреждать');
  stored = (await boris.get(`documents/${doc.id}`)).body as typeof stored;
  expect(stored.data.warnings).toEqual([]);

  // Форма правки не теряет «не предупреждать»: пустой список остаётся пустым.
  await page.getByRole('button', { name: 'Править' }).click();
  const form = page.locator('form.document-form');
  await expect(form.getByRole('checkbox', { name: 'Не предупреждать о сроке' })).toBeChecked();
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(toast(page)).toContainText('Документ сохранён');
  stored = (await boris.get(`documents/${doc.id}`)).body as typeof stored;
  expect(stored.data.warnings).toEqual([]);

  await row.getByRole('button', { name: 'Изменить предупреждения' }).click();
  await row.getByRole('button', { name: 'Как у типа' }).click();
  await expect(toast(page)).toContainText('Предупреждения как у типа');
  await expect(row).toContainText('за 30, 14 и 3 дня');
  await expect(row).toContainText('по умолчанию для типа');
  stored = (await boris.get(`documents/${doc.id}`)).body as typeof stored;
  expect(stored.data.warnings).toBeUndefined();
});

test('владелец документа: человек из контактов выбирается в форме и открывается из карточки', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const owner = await seedPerson(boris, { title: 'Вымышленный Владелец Олег' });
  await signInAs(page, family, 'adult');
  await page.goto('#/documents/new');
  const form = page.locator('form.document-form');
  await form.getByLabel('Название').fill('Паспорт Олега');
  await form.getByLabel('Тип документа').selectOption('russian_passport');
  await form.getByLabel('Чей документ').selectOption({ label: 'Вымышленный Владелец Олег' });
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Паспорт Олега' })).toBeVisible();
  await page.getByRole('link', { name: 'Вымышленный Владелец Олег', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленный Владелец Олег', exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain(owner.id);
});
