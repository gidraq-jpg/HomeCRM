import type { Locator, Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { apiAs, expectNothingStored, objectLinks, openAs, openHome } from './notes-support.ts';
import {
  openObjectTab,
  seedAccount,
  seedLink,
  seedOrganization,
  seedProperty,
} from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Недвижимость, лицевые счета, организации (R1a.1b): UTIL-1, UTIL-2, CONT-2, CONT-3, OBJ-5, сценарий S1.
// Семья вымышленная: Анна — администратор, Борис — взрослый, Вера — ребёнок.

const toast = (page: Page) => page.locator('.toast-region');
const objectForm = (page: Page) => page.locator('form.object-form');
const accountForm = (page: Page) => page.locator('form.account-form');
const orgForm = (dialog: Locator) => dialog.locator('form.org-form');

/** Заполняет форму организации (в панели или на экране): название, тип, телефон. */
async function fillOrganization(
  form: Locator,
  organization: { title: string; type?: string; phone?: { number: string; label: string } },
) {
  await form.getByLabel('Название', { exact: true }).fill(organization.title);
  if (organization.type)
    await form.getByLabel('Тип', { exact: true }).selectOption({ label: organization.type });
  if (organization.phone) {
    await form.getByRole('button', { name: 'Добавить телефон' }).click();
    await form.getByLabel('Телефон 1: номер').fill(organization.phone.number);
    await form.getByLabel('Телефон 1: подпись').fill(organization.phone.label);
    await form.getByRole('checkbox', { name: 'Аварийный' }).check();
  }
}

test('S1: первая квартира, три лицевых счёта, две организации — с экрана до конца', async ({
  page,
  family,
}, info) => {
  test.setTimeout(240_000);
  const consoleTexts: string[] = [];
  page.on('console', (message) => consoleTexts.push(message.text()));
  await signInAs(page, family, 'adult');

  // 1. Недвижимость: ошибки формата у поля, затем верные значения.
  await page.goto('#/home/new');
  await page.getByLabel('Название', { exact: true }).fill('Квартира у парка');
  await objectForm(page).getByRole('radio', { name: 'Недвижимость' }).check();
  await objectForm(page).getByLabel('Вид', { exact: true }).selectOption({ label: 'Квартира' });
  await objectForm(page).getByLabel('Адрес', { exact: true }).fill('Вымышленный проспект, 1');
  await objectForm(page).getByLabel('Площадь, м²').fill('много');
  await objectForm(page).getByLabel('Кадастровый номер').fill('66:41');
  await objectForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(objectForm(page).getByRole('alert').filter({ hasText: 'Площадь —' })).toBeVisible();
  await expect(
    objectForm(page).getByRole('alert').filter({ hasText: 'Кадастровый номер не похож' }),
  ).toContainText('66:41:0101001:123');
  await checkApp(page, info, 'property-form-error');

  await objectForm(page).getByLabel('Площадь, м²').fill('54,3');
  await objectForm(page).getByLabel('Кадастровый номер').fill('66:41:0101001:123');
  await objectForm(page).getByLabel('Статус', { exact: true }).selectOption({ label: 'Живём' });
  await objectForm(page).getByRole('checkbox', { name: 'Борис' }).check();
  await checkApp(page, info, 'property-form');
  await objectForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Объект сохранён');

  const heading = page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.locator('.page-heading').getByText('Живём')).toBeVisible();
  await expect(page.getByText(/54,3\s*м²/)).toBeVisible();
  await expect(page.getByText('66:41:0101001:123')).toBeVisible();
  await checkApp(page, info, 'property-card');
  const objectId = page.url().split('/home/')[1]?.split('/')[0] ?? '';

  // 2. Вкладка «Счета»: пусто, затем три счёта и две организации прямо из формы.
  await page
    .getByRole('navigation', { name: 'Разделы объекта' })
    .getByRole('link', { name: 'Счета' })
    .click();
  await expect(page.getByRole('region', { name: 'Лицевых счетов пока нет' })).toBeVisible();
  await checkApp(page, info, 'accounts-empty');

  await page.getByRole('button', { name: 'Добавить лицевой счёт' }).click();
  await accountForm(page).getByRole('checkbox', { name: 'Электроэнергия' }).check();
  await accountForm(page).getByRole('button', { name: 'Новая организация' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая организация' });
  await expect(dialog).toBeVisible();
  await fillOrganization(orgForm(dialog), {
    title: 'Вымышленная УК',
    type: 'УК или ТСЖ',
    phone: { number: '+7 000 123-45-67', label: 'Аварийная служба' },
  });
  await checkApp(page, info, 'account-new-organization');
  await orgForm(dialog).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    accountForm(page).getByLabel('Поставщик', { exact: true }).locator('option:checked'),
  ).toHaveText('Вымышленная УК');
  await accountForm(page).getByLabel('Номер лицевого счёта').fill('TEST-001');
  await accountForm(page)
    .getByLabel('Способ передачи показаний')
    .selectOption({ label: 'Госуслуги Дом' });
  await accountForm(page).getByLabel('С числа').fill('20');
  await accountForm(page).getByLabel('По число').fill('25');
  await accountForm(page).getByLabel('День оплаты').fill('15');
  await checkApp(page, info, 'account-form');
  await accountForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Лицевой счёт сохранён');

  // Второй счёт: тот же поставщик, передача по ссылке.
  await page.getByRole('button', { name: 'Добавить лицевой счёт' }).click();
  await accountForm(page).getByRole('checkbox', { name: 'Водоснабжение и водоотведение' }).check();
  await accountForm(page)
    .getByLabel('Поставщик', { exact: true })
    .selectOption({ label: 'Вымышленная УК' });
  await accountForm(page).getByLabel('Номер лицевого счёта').fill('TEST-002');
  await accountForm(page)
    .getByLabel('Способ передачи показаний')
    .selectOption({ label: 'Сайт или приложение поставщика' });
  await accountForm(page)
    .getByLabel('Ссылка на сайт или приложение поставщика')
    .fill('supplier.invalid/pokazaniya');
  await accountForm(page).getByLabel('С числа').fill('28');
  await accountForm(page).getByLabel('По число').fill('5');
  await accountForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Лицевые счета' }).getByRole('listitem')).toHaveCount(
    2,
  );

  // Третий счёт: вторая организация, созданная из формы без телефонов.
  await page.getByRole('button', { name: 'Добавить лицевой счёт' }).click();
  await accountForm(page).getByRole('checkbox', { name: 'Газ' }).check();
  await accountForm(page).getByRole('button', { name: 'Новая организация' }).click();
  await fillOrganization(orgForm(page.getByRole('dialog', { name: 'Новая организация' })), {
    title: 'Вымышленный Энергосбыт',
    type: 'Ресурсоснабжающая организация',
  });
  await orgForm(page.getByRole('dialog', { name: 'Новая организация' }))
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await accountForm(page).getByLabel('Номер лицевого счёта').fill('TEST-003');
  await accountForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();

  const list = page.getByRole('list', { name: 'Лицевые счета' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('heading', { level: 3 })).toHaveText([
    'Электроэнергия',
    'Водоснабжение и водоотведение',
    'Газ',
  ]);
  await expect(list).toContainText('с 20 по 25 числа');
  await expect(list).toContainText('с 28 по 5 числа следующего месяца');
  await expect(list).toContainText('15-го числа каждого месяца');
  await expect(list.getByRole('link', { name: 'Вымышленная УК' })).toHaveCount(2);
  await expect(list.getByRole('link', { name: /Сайт или приложение поставщика/ })).toHaveAttribute(
    'href',
    'https://supplier.invalid/pokazaniya',
  );
  await checkApp(page, info, 'accounts-list');

  // 3. «Люди и организации»: УК связана с квартирой, подпись роли — «УК».
  await page
    .getByRole('navigation', { name: 'Разделы объекта' })
    .getByRole('link', { name: 'Обзор' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Люди и организации' })).toBeVisible();
  await page.getByRole('button', { name: 'Связать с организацией…' }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Связать с организацией' });
  await expect(linkDialog.getByRole('button', { name: 'Связать', exact: true })).toBeDisabled();
  await linkDialog.getByRole('button', { name: /Вымышленная УК/ }).click();
  await linkDialog.getByRole('button', { name: 'УК', exact: true }).click();
  await checkApp(page, info, 'people-link-sheet');
  await linkDialog.getByRole('button', { name: 'Связать', exact: true }).click();
  await expect(toast(page)).toContainText('Организация связана с объектом');
  const people = page.getByRole('list', { name: 'Люди и организации' });
  await expect(people).toContainText('Вымышленная УК');
  await expect(people).toContainText('УК');
  await checkApp(page, info, 'people-block');

  // 4. «Ещё → Организации»: список, фильтр по типу, карточка с телефонами.
  await page.goto('#/more');
  await page.getByRole('link', { name: /^Организации/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Организации', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Организации' }).getByRole('listitem')).toHaveCount(
    2,
  );
  await checkApp(page, info, 'organizations-list');
  await page.getByLabel('Тип организации').selectOption({ label: 'УК или ТСЖ' });
  await expect(page.getByRole('list', { name: 'Организации' }).getByRole('listitem')).toHaveCount(
    1,
  );
  await page.getByRole('link', { name: /Вымышленная УК/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленная УК', exact: true }),
  ).toBeVisible();
  const phones = page.getByRole('list', { name: 'Телефоны' });
  await expect(phones).toContainText('+7 000 123-45-67');
  await expect(phones).toContainText('Аварийная служба');
  await expect(phones).toContainText('Аварийный');
  await expect(phones.getByRole('link', { name: /Позвонить/ })).toHaveAttribute(
    'href',
    'tel:+70001234567',
  );
  await phones.getByRole('button', { name: 'Скопировать номер телефона' }).click();
  await expect(toast(page)).toContainText('Скопировано: номер телефона');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('+7 000 123-45-67');
  await checkApp(page, info, 'organization-card');

  // 5. Ни названий, ни номеров, ни адресов нет в хранилищах, кэше, адресе и консоли.
  const secrets = [
    'TEST-001',
    'Вымышленная УК',
    '66:41:0101001:123',
    'Вымышленный проспект',
    'Энергосбыт',
  ];
  await expectNothingStored(page, secrets);
  for (const secret of secrets) expect(consoleTexts.join('\n')).not.toContain(secret);
  expect(objectId).not.toBe('');
});

test('недвижимость: статус рядом с названием в «Доме» и в карточке, правка полей', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    typeData: {
      kind: 'apartment',
      address: 'Вымышленный проспект, 1',
      areaHundredths: 5731,
      cadastralNumber: '66:41:0101001:123',
      status: 'rented',
      ownerMemberIds: [family.person('adult').id],
    },
  });
  await signInAs(page, family, 'adult');
  await openHome(page);
  const row = objectLinks(page).filter({ hasText: 'Квартира у парка' });
  await expect(row).toContainText('Сдаётся');
  await expect(row).toContainText('Вымышленный проспект, 1');
  await checkApp(page, info, 'property-home-list');

  await row.click();
  await expect(page.locator('.page-heading').getByText('Сдаётся')).toBeVisible();
  await expect(page.getByText(/57,31\s*м²/)).toBeVisible();
  await expect(page.getByText('Квартира', { exact: true })).toBeVisible();

  // Правка: статус и площадь; остальное сохраняется.
  await page.getByRole('button', { name: 'Править' }).click();
  await expect(objectForm(page).getByLabel('Площадь, м²')).toHaveValue('57,31');
  await expect(objectForm(page).getByRole('checkbox', { name: 'Борис' })).toBeChecked();
  await objectForm(page).getByLabel('Статус', { exact: true }).selectOption({ label: 'Пустует' });
  await objectForm(page).getByLabel('Площадь, м²').fill('60.5');
  await objectForm(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Объект сохранён');
  await expect(page.locator('.page-heading').getByText('Пустует')).toBeVisible();
  await expect(page.getByText(/60,5\s*м²/)).toBeVisible();

  const stored = await family.database.admin.query('SELECT type_data FROM objects WHERE id = $1', [
    object.id,
  ]);
  expect(stored.rows[0]?.type_data).toEqual({
    kind: 'apartment',
    address: 'Вымышленный проспект, 1',
    areaHundredths: 6050,
    cadastralNumber: '66:41:0101001:123',
    status: 'vacant',
    ownerMemberIds: [family.person('adult').id],
  });
});

test('скрытый поставщик: «не указан или скрыт», сохранение других полей его не стирает', async ({
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
  });
  const hidden = await seedOrganization(boris, {
    title: 'Вымышленный личный мастер',
    placement: { spaceId: family.person('adult').personalSpaceId },
  });
  const account = await seedAccount(boris, object.id, {
    title: 'Лицевой счёт',
    supplierId: hidden.id,
    data: { number: 'TEST-777' },
  });

  const anna = await openAs(browser, family, info, 'admin');
  try {
    await openObjectTab(anna.page, object.id, '/accounts', 'Квартира у парка');
    const list = anna.page.getByRole('list', { name: 'Лицевые счета' });
    await expect(list).toContainText('не указан или скрыт');
    await expect(list).not.toContainText('Вымышленный личный мастер');
    await expect(list.getByRole('link', { name: /мастер/ })).toHaveCount(0);
    await checkApp(anna.page, info, 'account-hidden-supplier');

    await list.getByRole('button', { name: 'Править' }).click();
    await expect(anna.page.getByLabel('Поставщик', { exact: true })).toHaveValue('');
    await expect(anna.page.getByText('Если поставщик скрыт от вас')).toBeVisible();
    await anna.page.getByLabel('Заметка', { exact: true }).fill('Заметка администратора');
    await accountForm(anna.page).getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(toast(anna.page)).toContainText('Лицевой счёт сохранён');
  } finally {
    await anna.close();
  }
  const stored = await family.database.admin.query(
    'SELECT supplier_id, data FROM utility_accounts WHERE id = $1',
    [account.id],
  );
  expect(stored.rows[0]?.supplier_id).toBe(hidden.id);
  expect(stored.rows[0]?.data.note).toBe('Заметка администратора');
  expect(stored.rows[0]?.data.number).toBe('TEST-777');
});

test('ребёнок: не видит «Счета» объекта «Взрослые» и связь с УК, но видит саму организацию', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const adultsOnly = await seedProperty(boris, family, {
    title: 'Квартира взрослых',
    audience: 'adults',
  });
  const uk = await seedOrganization(boris, {
    title: 'Вымышленная УК',
    data: {
      organizationType: 'management',
      phones: [{ number: '+7 000 123-45-67', label: 'Диспетчер', emergency: true }],
    },
  });
  await seedLink(boris, adultsOnly.id, uk.id, 'УК');
  await seedAccount(boris, adultsOnly.id, { supplierId: uk.id, data: { number: 'TEST-ADULTS' } });
  const familyHouse = await seedProperty(boris, family, {
    title: 'Семейный дом',
    audience: 'household',
    typeData: { status: 'living' },
  });
  await seedAccount(boris, familyHouse.id, {
    title: 'Электроэнергия',
    data: { services: ['electricity'], number: 'TEST-FAMILY' },
  });

  await signInAs(page, family, 'child');
  await openHome(page);
  await expect(objectLinks(page)).toHaveCount(1);
  await expect(objectLinks(page)).toContainText('Семейный дом');

  // Объект «Взрослые» недоступен: ни карточки, ни вкладки «Счета», ни номера счёта.
  await page.goto(`#/home/${adultsOnly.id}/accounts`);
  await expect(page.getByText('Объекта больше нет, или он стал вам недоступен')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Счета' })).toHaveCount(0);
  await expect(page.getByText('TEST-ADULTS')).toHaveCount(0);
  await checkApp(page, info, 'property-child-hidden');

  // Организация «Вся семья» видна, связь с квартирой «Взрослые» — нет.
  await page.goto('#/more/organizations');
  await expect(page.getByRole('link', { name: /Вымышленная УК/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Добавить организацию' })).toHaveCount(0);
  await checkApp(page, info, 'organizations-child');
  await page.getByRole('link', { name: /Вымышленная УК/ }).click();
  await expect(page.getByRole('list', { name: 'Телефоны' })).toContainText('Диспетчер');
  await expect(page.getByText('Квартира взрослых')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Править' })).toHaveCount(0);
  await checkApp(page, info, 'organization-child');
  const child = await apiAs(family, 'child');
  expect((await child.get(`records/contact/${uk.id}/links`)).body).toEqual([]);
  expect((await child.get(`objects/${adultsOnly.id}/accounts`)).status).toBe(404);

  // Объект «Вся семья»: счета видны, менять их ребёнок не может.
  await page.goto('#/more');
  await page.goto(`#/home/${familyHouse.id}/accounts`);
  await expect(page.getByRole('list', { name: 'Лицевые счета' })).toContainText('TEST-FAMILY');
  await expect(
    page.getByRole('button', { name: /Добавить лицевой счёт|Править|В корзину/ }),
  ).toHaveCount(0);
  await checkApp(page, info, 'accounts-child-readonly');
});

test('организации: только название, правка, корзина с отменой и восстановление из «Корзины»', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/organizations');
  const empty = page.getByRole('region', { name: 'Организаций пока нет' });
  await expect(empty).toBeVisible();
  await checkApp(page, info, 'organizations-empty');
  await empty.getByRole('button', { name: 'Добавить организацию' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Новая организация' })).toBeVisible();

  // Название обязательно, остальное нет; «Вся семья» по умолчанию.
  await page
    .locator('form.org-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Введите название' })).toBeVisible();
  await expect(page.getByLabel('Название', { exact: true })).toBeFocused();
  await page.locator('form.org-form').getByLabel('Сайт').fill('не сайт');
  await page.getByLabel('Название', { exact: true }).fill('Вымышленная школа');
  await page
    .locator('form.org-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сайт — ссылка' })).toBeVisible();
  await checkApp(page, info, 'organization-form-error');
  await expect(
    page
      .locator('form.org-form')
      .getByRole('group', { name: 'Кто видит' })
      .getByRole('radio', { name: 'Вся семья' }),
  ).toBeChecked();
  await page.locator('form.org-form').getByLabel('Сайт').fill('school.invalid');
  await page
    .locator('form.org-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(toast(page)).toContainText('Организация сохранена');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вымышленная школа', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'school.invalid' })).toHaveAttribute(
    'href',
    'https://school.invalid',
  );
  await expect(page.getByText('Телефонов пока нет.')).toBeVisible();

  // Правка: телефон с меткой «аварийный».
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByRole('button', { name: 'Добавить телефон' }).click();
  await page.getByLabel('Телефон 1: номер').fill('8 (000) 555-00-11');
  await page.getByLabel('Телефон 1: подпись').fill('Приёмная');
  await page
    .locator('form.org-form')
    .getByLabel('Тип', { exact: true })
    .selectOption({ label: 'Школа' });
  await checkApp(page, info, 'organization-form-edit');
  await page
    .locator('form.org-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(toast(page)).toContainText('Организация сохранена');
  await expect(page.getByRole('list', { name: 'Телефоны' })).toContainText('8 (000) 555-00-11');
  await expect(page.getByRole('list', { name: 'Телефоны' })).not.toContainText('Аварийный');

  // Корзина с отменой 7 секунд.
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Организация в корзине');
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Организация возвращена');
  await page.goto('#/more/organizations');
  await expect(page.getByRole('link', { name: /Вымышленная школа/ })).toBeVisible();

  await page.getByRole('link', { name: /Вымышленная школа/ }).click();
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.getByRole('region', { name: 'Организаций пока нет' })).toBeVisible();
  await page.goto('#/more/trash');
  const trash = page.getByRole('list', { name: 'Удалённые организации' });
  await expect(trash).toContainText('Вымышленная школа');
  await checkApp(page, info, 'trash-organizations');
  await trash.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Организация возвращена');
  await expect(page.getByRole('list', { name: 'Удалённые организации' })).toHaveCount(0);
});

test('лицевой счёт: корзина с отменой, «Корзина» и возврат вместе с объектом', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
  });
  await seedAccount(boris, object.id, {
    title: 'Электроэнергия',
    data: { services: ['electricity'], number: 'TEST-111' },
  });
  await seedAccount(boris, object.id, {
    title: 'Газ',
    data: { services: ['gas'], number: 'TEST-222' },
  });
  await signInAs(page, family, 'adult');
  await openObjectTab(page, object.id, '/accounts', 'Квартира у парка');

  const list = page.getByRole('list', { name: 'Лицевые счета' });
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Электроэнергия' })
    .getByRole('button', { name: 'В корзину' })
    .click();
  await expect(toast(page)).toContainText('Лицевой счёт в корзине');
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Лицевой счёт возвращён');
  await expect(list.getByRole('listitem')).toHaveCount(2);

  // Номер копируется одним касанием.
  await list.getByRole('button', { name: 'Скопировать номер лицевого счёта' }).first().click();
  await expect(toast(page)).toContainText('Скопировано: номер лицевого счёта');

  // Счёт «Газ» удалён отдельно; счёт «Электроэнергия» уйдёт вместе с объектом.
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Газ' })
    .getByRole('button', { name: 'В корзину' })
    .click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Разделы объекта' })
    .getByRole('link', { name: 'Обзор' })
    .click();
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();

  await page.goto('#/more/trash');
  const objects = page.getByRole('list', { name: 'Удалённые объекты' });
  await expect(objects).toContainText('Лицевые счета вернутся вместе с объектом.');
  // Счёт «Газ» удалён отдельно, но его объект сейчас в корзине: он появится после возврата объекта.
  await expect(page.getByRole('list', { name: 'Удалённые лицевые счета' })).toHaveCount(0);
  await objects.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Объект возвращён');

  const accounts = page.getByRole('list', { name: 'Удалённые лицевые счета' });
  await expect(accounts).toContainText('Газ');
  await expect(accounts).toContainText('Квартира у парка');
  await expect(accounts).not.toContainText('Электроэнергия');
  await checkApp(page, info, 'trash-accounts');
  await accounts.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Лицевой счёт возвращён');

  await openObjectTab(page, object.id, '/accounts', 'Квартира у парка');
  await expect(page.getByRole('list', { name: 'Лицевые счета' }).getByRole('listitem')).toHaveCount(
    2,
  );
});
