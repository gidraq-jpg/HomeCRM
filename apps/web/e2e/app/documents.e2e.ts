import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, openRadar, recalc, setHomeZone } from './deadlines-support.ts';
import {
  addChild,
  apiAsChild2,
  collectConsole,
  documentLinks,
  openAsUser,
  openDocuments,
  seedDocument,
} from './documents-support.ts';
import { makePng, PNG_MIME } from './files-support.ts';
import { apiAs, expectNothingStored, openAs } from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Документы (R1a.9b): DOC-1…2, DOC-5…7. Семья вымышленная: Борис — взрослый, Вера — ребёнок,
// Петя — второй ребёнок. Серии и номера выдуманные: ни в консоли, ни в адресе, ни в хранилищах их быть не должно.

const toast = (page: Page) => page.locator('.toast-region');
const SERIES = '75 12';
const NUMBER = '1234567';

test('документ с двумя страницами: серия и номер скрыты до «Показать», копируются, не оседают нигде', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const messages = collectConsole(page);
  await signInAs(page, family, 'adult');
  await openDocuments(page);
  await expect(page.getByRole('region', { name: 'Документов пока нет' })).toBeVisible();
  await checkApp(page, info, 'documents-empty');
  await page.getByRole('link', { name: 'Добавить документ' }).click();

  // Форма: «Кто видит» над «Сохранить»; документ взрослого по умолчанию личный (PRD 7.2).
  const form = page.locator('form.document-form');
  await expect(page.getByRole('heading', { level: 1, name: 'Новый документ' })).toBeVisible();
  await form.getByLabel('Название').fill('Загранпаспорт Бориса');
  await form.getByLabel('Тип документа').selectOption('international_passport');
  await form.getByLabel('Серия').fill(SERIES);
  await form.getByLabel('Номер').fill(NUMBER);
  await form.getByLabel('Кем выдан').fill('Вымышленное ведомство');
  await form.getByLabel('Дата выдачи').fill(homeDate(-3000));
  await form.getByLabel('Срок действия до').fill(homeDate(45));
  await form.getByLabel('Теги').fill('поездка');
  await expect(form.getByRole('radio', { name: /Только я/ })).toBeChecked();
  const html = await form.innerHTML();
  expect(html.indexOf('Кто видит')).toBeLessThan(html.indexOf('Сохранить'));
  await checkApp(page, info, 'document-form');

  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/api/documents'),
  );
  await form.getByRole('button', { name: 'Сохранить' }).click();
  const body = (await request).postDataJSON() as {
    data: { type: string; series: string; number: string; tags: string[] };
    owner: { kind: string };
    placement?: { audience?: string };
  };
  expect(body.data).toMatchObject({
    type: 'international_passport',
    series: SERIES,
    tags: ['поездка'],
  });
  expect(body.owner.kind).toBe('member');
  expect(body.placement?.audience).toBeUndefined();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Загранпаспорт Бориса', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Документ — HomeCRM');

  // Серия и номер на экране скрыты, пока не нажато «Показать».
  await expect(page.getByText(NUMBER)).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать' }).click();
  await expect(page.getByText(`${SERIES} ${NUMBER}`)).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть' }).click();
  await expect(page.getByText(NUMBER)).toHaveCount(0);
  await page.getByRole('button', { name: 'Скопировать серию и номер' }).click();
  await expect(toast(page)).toContainText('Серия и номер скопированы');
  await expect(toast(page)).not.toContainText(NUMBER);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${SERIES} ${NUMBER}`);

  // Две страницы-скана.
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'stranica-1.png', mimeType: PNG_MIME, buffer: makePng(64, 64) },
    { name: 'stranica-2.png', mimeType: PNG_MIME, buffer: makePng(64, 80) },
  ]);
  const pages = page.getByRole('list', { name: 'Файлы записи' }).getByRole('listitem');
  await expect(pages).toHaveCount(2);

  // Скан открывается на весь экран.
  await page.getByRole('button', { name: /^Открыть: stranica-1/ }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр файла' });
  await expect(viewer).toBeVisible();
  const size = await viewer.boundingBox();
  const viewport = page.viewportSize();
  expect(size?.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await checkApp(page, info, 'document-card');

  await expectNothingStored(page, [SERIES, NUMBER, 'Загранпаспорт Бориса', 'stranica-1']);
  expect(messages.join('\n')).not.toContain(NUMBER);
  expect(messages.join('\n')).not.toContain('Загранпаспорт');
});

test('продление: новая версия, история версий, старая — «недействителен»', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const old = await seedDocument(boris, {
    title: 'ОСАГО Субару',
    type: 'osago',
    series: 'XXX',
    number: '0000111',
    issuedOn: homeDate(-345),
    expiresOn: homeDate(20),
    owner: { kind: 'member', id: family.person('adult').id },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/documents/${old.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'ОСАГО Субару', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Истекает через 20 дней')).toBeVisible();

  await page.getByRole('button', { name: 'Продлить' }).click();
  const form = page.locator('form.document-form');
  // Реквизиты перенесены, даты вводятся заново.
  await expect(form.getByLabel('Номер')).toHaveValue('0000111');
  await expect(form.getByLabel('Срок действия до')).toHaveValue('');
  await form.getByLabel('Дата выдачи').fill(homeDate(0));
  await form.getByLabel('Срок действия до').fill(homeDate(365));
  await checkApp(page, info, 'document-renew');
  await form.getByRole('button', { name: 'Создать новую версию' }).click();
  await expect(toast(page)).toContainText('Создана новая версия');

  // На новой версии — история из двух версий.
  const versions = page.getByRole('list', { name: 'Версии документа' });
  await expect(versions.getByRole('listitem')).toHaveCount(2);
  await expect(versions.getByText('Недействителен', { exact: true })).toBeVisible();
  await expect(versions.getByText('Эта версия')).toBeVisible();
  await checkApp(page, info, 'document-versions');

  // Старая версия — «недействителен»: правка и продление недоступны, есть путь к действующей.
  await versions.getByRole('link', { name: /Открыть версию/ }).click();
  await expect(page.getByText('Недействителен.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть действующую версию' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продлить' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Править' })).toHaveCount(0);
  await checkApp(page, info, 'document-invalid');
  expect((await boris.patch(`documents/${old.id}`, { title: 'Другое название' })).status).toBe(409);

  // В списке по умолчанию только действующая версия, «Все версии» показывает обе.
  await openDocuments(page);
  await expect(documentLinks(page)).toHaveCount(1);
  await page.getByRole('radio', { name: 'Все версии' }).check();
  await expect(documentLinks(page)).toHaveCount(2);
});

test('список: фильтры «истекает в 90 дней», «просрочен», тип, человек, пространство и поиск', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const me = { kind: 'member' as const, id: family.person('adult').id };
  await seedDocument(boris, {
    title: 'ОСАГО Субару',
    type: 'osago',
    expiresOn: homeDate(20),
    owner: me,
  });
  await seedDocument(boris, {
    title: 'Полис КАСКО',
    type: 'kasko',
    expiresOn: homeDate(-5),
    owner: me,
  });
  await seedDocument(boris, {
    title: 'Договор аренды',
    type: 'contract',
    expiresOn: homeDate(400),
    owner: me,
  });
  await seedDocument(boris, {
    title: 'Дачная страховка',
    type: 'property_insurance',
    owner: me,
  });
  await seedDocument(boris, {
    title: 'Свидетельство Веры',
    type: 'birth_certificate',
    indefinite: true,
    owner: { kind: 'member', id: family.person('child').id },
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  await signInAs(page, family, 'adult');
  await openDocuments(page);
  await expect(documentLinks(page)).toHaveCount(5);

  await page.getByRole('radio', { name: 'Истекает в 90 дней' }).check();
  await expect(documentLinks(page)).toHaveCount(1);
  await expect(documentLinks(page).first()).toContainText('ОСАГО Субару');
  await expect(documentLinks(page).first()).toContainText('Истекает через 20 дней');
  await checkApp(page, info, 'documents-expiring');

  await page.getByRole('radio', { name: 'Просрочен' }).check();
  await expect(documentLinks(page)).toHaveCount(1);
  await expect(documentLinks(page).first()).toContainText('Полис КАСКО');
  await expect(documentLinks(page).first()).toContainText('Просрочен на 5 дней');
  await checkApp(page, info, 'documents-expired');

  await page.getByRole('radio', { name: 'Любой срок' }).check();
  await page.getByLabel('Тип', { exact: true }).selectOption('contract');
  await expect(documentLinks(page)).toHaveCount(1);
  await expect(documentLinks(page).first()).toContainText('Договор аренды');
  await page.getByLabel('Тип', { exact: true }).selectOption('');

  await page.getByLabel('Человек').selectOption({ label: 'Вера' });
  await expect(documentLinks(page)).toHaveCount(1);
  await expect(documentLinks(page).first()).toContainText('Свидетельство Веры');
  await page.getByLabel('Человек').selectOption('');

  // Пространство — общий переключатель: «Общее» оставляет только документ ребёнка для взрослых.
  await page.getByRole('radio', { name: 'Общее', exact: true }).check();
  await expect(documentLinks(page)).toHaveCount(1);
  await page.getByRole('radio', { name: 'Личное', exact: true }).check();
  await expect(documentLinks(page)).toHaveCount(4);
  await page.getByRole('radio', { name: 'Всё', exact: true }).check();

  // Поиск находит по названию и по типу (название документа слова «имущества» не содержит).
  await page.getByLabel('Поиск по названию и типу').fill('каско');
  await expect(documentLinks(page)).toHaveCount(1);
  await page.getByLabel('Поиск по названию и типу').fill('имущества');
  await expect(documentLinks(page)).toHaveCount(1);
  await expect(documentLinks(page).first()).toContainText('Дачная страховка');
  await page.getByLabel('Поиск по названию и типу').fill('нет такого');
  await expect(page.getByRole('region', { name: 'Ничего не нашлось' })).toBeVisible();
  await checkApp(page, info, 'documents-nothing');
});

test('радар: срок документа ведёт в карточку, предупреждение дальше 90 дней — в группе «Позже»', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const me = { kind: 'member' as const, id: family.person('adult').id };
  const soon = await seedDocument(boris, {
    title: 'ОСАГО Субару',
    type: 'osago',
    expiresOn: homeDate(20),
    owner: me,
  });
  const later = await seedDocument(boris, {
    title: 'Загранпаспорт Бориса',
    type: 'international_passport',
    expiresOn: homeDate(150),
    owner: me,
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  const soonRow = page
    .getByRole('listitem')
    .filter({ hasText: 'ОСАГО Субару' })
    .filter({ hasText: 'Срок документа' });
  await expect(soonRow.getByRole('link')).toHaveAttribute('href', `#/documents/${soon.id}`);
  const laterGroup = page.getByRole('list', { name: 'Позже', exact: true });
  await expect(laterGroup).toContainText('Загранпаспорт Бориса');
  await expect(laterGroup.getByRole('link')).toHaveAttribute('href', `#/documents/${later.id}`);
  // «Позже» идёт последней группой.
  const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts();
  expect(headings.at(-1)).toBe('Позже');
  await checkApp(page, info, 'documents-radar');
  await laterGroup.getByRole('link').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Загранпаспорт Бориса', exact: true }),
  ).toBeVisible();
});

test('ребёнок не видит паспорт другого ребёнка и документы взрослых', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const petya = await addChild(family);
  const passport = await seedDocument(boris, {
    title: 'Паспорт Веры',
    type: 'russian_passport',
    series: '45 10',
    number: '7654321',
    expiresOn: homeDate(900),
    owner: { kind: 'member', id: family.person('child').id },
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const school = await seedDocument(boris, {
    title: 'Справка из школы',
    type: 'school',
    owner: { kind: 'member', id: family.person('child').id },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const own = await seedDocument(boris, { title: 'Личный полис Бориса', type: 'oms' });
  await signInAs(page, family, 'adult');
  await openDocuments(page);
  await expect(documentLinks(page)).toHaveCount(3);
  await checkApp(page, info, 'documents-adult');

  // Удостоверение ребёнка нельзя открыть всей семьёй даже в базе: другой ребёнок его не увидит.
  await expect(
    family.database.admin.query("UPDATE documents SET audience = 'household' WHERE id = $1", [
      passport.id,
    ]),
  ).rejects.toThrow('child identity requires adults');

  const kid = await openAsUser(browser, family, info, petya);
  const vera = await openAs(browser, family, info, 'child');
  try {
    const apiPetya = await apiAsChild2(family, petya);
    const apiVera = await apiAs(family, 'child');
    for (const api of [apiPetya, apiVera]) {
      expect((await api.get(`documents/${own.id}`)).status).toBe(404);
    }
    expect((await apiPetya.get(`documents/${passport.id}`)).status).toBe(404);
    expect((await apiPetya.get('documents')).body).toEqual([
      expect.objectContaining({ id: school.id }),
    ]);

    await openDocuments(kid.page);
    await expect(documentLinks(kid.page)).toHaveCount(1);
    await expect(kid.page.getByText('Справка из школы')).toBeVisible();
    await expect(kid.page.getByText('Паспорт Веры')).toHaveCount(0);
    await expect(kid.page.getByText('Личный полис Бориса')).toHaveCount(0);
    await kid.page.goto(`#/documents/${passport.id}`);
    await expect(kid.page.getByText('Документа больше нет')).toBeVisible();
    await expect(kid.page.getByText('7654321')).toHaveCount(0);
    await checkApp(kid.page, info, 'documents-child');
  } finally {
    await kid.close();
    await vera.close();
  }
});
