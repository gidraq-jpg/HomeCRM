import { test } from '../auth/support/fixtures.ts';
import { setScope } from '../support/helpers.ts';
import {
  deadlinesSection,
  groupItems,
  homeDate,
  openObjectCard,
  openRadar,
  recalc,
  seedDeadline,
  setHomeZone,
} from './deadlines-support.ts';
import {
  expectImageLoaded,
  filePicker,
  fileRows,
  makePng,
  PDF,
  PDF_MIME,
  PNG_MIME,
} from './files-support.ts';
import { apiAs, noteLinks, objectLinks, seedNote, seedObject } from './notes-support.ts';
import {
  devicesList,
  installFakePush,
  openNotifications,
  seedAttempt,
  seedDevice,
  thisDevice,
} from './notifications-support.ts';
import { checkApp, expect, seedProfiles, signInAs } from './support.ts';

// Компьютер (PRD, раздел 14): боковое меню со всеми разделами; переключатель пространств и
// поиск — в шапке. Нижнего меню на широком экране нет. Идёт на 1280 px, см. playwright.config.ts.

test('боковое меню вместо нижнего, переключатель и поиск в шапке', async ({
  page,
  family,
}, info) => {
  await seedProfiles(family);
  await signInAs(page, family, 'adult');

  const side = page.getByRole('navigation', { name: 'Основные разделы' });
  await expect(side).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('nav:visible[aria-label="Основные разделы"]')).toHaveCount(1);
  await expect(side.getByRole('link')).toHaveText(['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']);
  await expect(side.getByRole('link', { name: 'Сегодня' })).toHaveAttribute('aria-current', 'page');

  // Шапка: переключатель и поиск рядом с содержимым, а не в боковом меню.
  const header = page.locator('header.topbar');
  await expect(header.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(header.getByRole('link', { name: 'Поиск', exact: true })).toBeVisible();
  await expect(side.getByRole('radio')).toHaveCount(0);
  await checkApp(page, info, 'desktop-today');

  for (const section of ['Дом', 'Документы', 'Люди', 'Ещё']) {
    await side.getByRole('link', { name: section, exact: true }).click();
    await expect(side.getByRole('link', { name: section, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 1, name: section, exact: true })).toBeVisible();
  }
  await side.getByRole('link', { name: 'Люди', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Участники дома' }).getByRole('listitem'),
  ).toHaveCount(3);
  await setScope(page, 'Личное');
  await expect(side.getByRole('link', { name: 'Люди', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await checkApp(page, info, 'desktop-people-personal');
  await setScope(page, 'Всё');
  await checkApp(page, info, 'desktop-people');

  // Кнопка «+» не закрывает содержимое и остаётся у края окна.
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  await expect(add).toBeVisible();
  const box = await add.boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1200);
});

test('заметки на компьютере: список, карточка и «Кто видит» рядом с боковым меню', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, {
    title: 'Ремонт кухни',
    body: '# План\n\nНужна **краска** и скотч.',
    pinned: true,
    checklist: [{ title: 'Купить краску' }, { title: 'Позвонить мастеру', done: true }],
  });
  await seedNote(boris, family, {
    title: 'Правила дома',
    body: 'Обувь у двери.',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');

  const side = page.getByRole('navigation', { name: 'Основные разделы' });
  await side.getByRole('link', { name: 'Ещё', exact: true }).click();
  await page.getByRole('link', { name: /^Заметки/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Заметки', exact: true })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Ещё', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(noteLinks(page)).toHaveCount(2);
  await checkApp(page, info, 'desktop-notes');

  await noteLinks(page).filter({ hasText: 'Ремонт кухни' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ремонт кухни', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Выполнено 1 из 2')).toBeVisible();
  await checkApp(page, info, 'desktop-note');

  await page.goto('#/more/notes');
  await noteLinks(page).filter({ hasText: 'Правила дома' }).click();
  await page.getByRole('button', { name: 'Кто видит…' }).click();
  await expect(page.getByRole('dialog', { name: 'Кто видит заметку' })).toBeVisible();
  await checkApp(page, info, 'desktop-note-audience');
});

test('«Дом» на компьютере: список, карточка с вкладками и лента рядом с боковым меню', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'adults',
    fields: [{ name: 'Площадь', value: '54 м²' }],
  });
  await seedObject(boris, family, {
    title: 'Семейная машина',
    objectType: 'car',
    audience: 'household',
  });
  await boris.post(`objects/${flat.id}/events`, {
    occurredOn: '2026-10-02',
    text: 'Заменили смеситель',
    amountKopecks: 184_050,
    rating: 5,
  });
  await signInAs(page, family, 'adult');

  const side = page.getByRole('navigation', { name: 'Основные разделы' });
  await side.getByRole('link', { name: 'Дом', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Дом', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(objectLinks(page)).toHaveCount(2);
  await checkApp(page, info, 'desktop-home');

  await objectLinks(page).filter({ hasText: 'Квартира у парка' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  await expect(side.getByRole('link', { name: 'Дом', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('term').filter({ hasText: 'Площадь' })).toBeVisible();
  await checkApp(page, info, 'desktop-object');

  await page.getByRole('link', { name: 'Лента', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Лента объекта' })).toContainText(
    'Заменили смеситель',
  );
  await checkApp(page, info, 'desktop-object-timeline');
});

test('фото профиля и «Корзина» с файлами на компьютере рядом с боковым меню', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'household',
  });
  const answer = await boris.upload(`objects/${flat.id}/files`, {
    name: 'Квитанция за воду.pdf',
    type: PDF_MIME,
    data: PDF,
  });
  const fileId = (answer.body as { id: string }).id;
  await boris.post(`objects/${flat.id}/files/${fileId}/trash`, {});
  await signInAs(page, family, 'adult');

  await page.goto('#/more/profile');
  await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible();
  await filePicker(page).setInputFiles({
    name: 'Мой портрет.png',
    mimeType: PNG_MIME,
    buffer: makePng(900, 900),
  });
  await expect(page.getByRole('button', { name: 'Сменить фото' })).toBeVisible();
  await expectImageLoaded(page, '.member-head .avatar__photo');
  await checkApp(page, info, 'desktop-profile-photo');

  await page.goto('#/more/trash');
  await expect(page.getByRole('list', { name: 'Удалённые файлы' })).toContainText(
    'Квитанция за воду.pdf',
  );
  await checkApp(page, info, 'desktop-trash-files');

  await page.goto(`#/home/${flat.id}/files`);
  await expect(page.getByRole('list', { name: 'Удалённые файлы' })).toContainText(
    'Квитанция за воду.pdf',
  );
  await checkApp(page, info, 'desktop-files-deleted');
});

test('вкладка «Файлы» на компьютере: загрузка фото и PDF, превью рядом с боковым меню', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}/files`);
  await expect(page.getByRole('region', { name: 'Файлов пока нет' })).toBeVisible();
  await checkApp(page, info, 'desktop-files-empty');

  await filePicker(page).setInputFiles([
    { name: 'Фото счётчика.png', mimeType: PNG_MIME, buffer: makePng(1200, 800) },
    { name: 'Квитанция за воду.pdf', mimeType: PDF_MIME, buffer: PDF },
  ]);
  await expect(fileRows(page)).toHaveCount(2);
  await expectImageLoaded(page, '.file-row__image');
  await checkApp(page, info, 'desktop-files');
});

test('сроки и радар на компьютере: блок в карточке, радар, настройки дома', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка',
    audience: 'household',
  });
  await seedDeadline(boris, 'objects', flat.id, { kind: 'date', date: homeDate(-2) });
  await seedDeadline(boris, 'objects', flat.id, {
    kind: 'repeat',
    anchor: homeDate(-60),
    repeat: { unit: 'month', day: 20 },
    durationDays: 5,
    time: '09:00',
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openObjectCard(page, flat.id, 'Квартира у парка');
  await expect(deadlinesSection(page).getByRole('listitem')).toHaveCount(2);
  await checkApp(page, info, 'desktop-deadlines-card');
  await deadlinesSection(page).getByRole('button', { name: 'Добавить срок', exact: true }).click();
  await checkApp(page, info, 'desktop-deadlines-form');

  await openRadar(page);
  await expect(groupItems(page, 'Просрочено').first()).toBeVisible();
  await checkApp(page, info, 'desktop-radar');
  await page.goto('#/more/house');
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки дома' })).toBeVisible();
  await checkApp(page, info, 'desktop-house');
});

test('уведомления на компьютере: карточка, экран, список устройств и журнал', async ({
  page,
  family,
}, info) => {
  const phone = await seedDevice(await apiAs(family, 'adult'), 'Телефон Бориса', 'desktop-phone');
  await seedAttempt(family, family.person('adult').id, phone, { result: 'sent', minutesAgo: 45 });
  await seedAttempt(family, family.person('adult').id, phone, {
    result: 'retry',
    errorCode: 503,
    minutesAgo: 120,
  });
  await installFakePush(page, { answer: 'granted' });
  await signInAs(page, family, 'adult');

  const card = page.getByRole('region', { name: 'Уведомления о сроках' });
  await expect(card).toBeVisible();
  await checkApp(page, info, 'desktop-notifications-card');
  await card.getByRole('button', { name: 'Включить уведомления' }).click();
  await expect(card).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Основные разделы' })
    .getByRole('link', { name: 'Ещё' })
    .click();
  await page.getByRole('link', { name: /^Уведомления/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Уведомления', exact: true }),
  ).toBeVisible();
  await expect(thisDevice(page)).toContainText('Включено');
  await expect(devicesList(page).getByRole('listitem')).toHaveCount(2);
  await checkApp(page, info, 'desktop-notifications');
  await openNotifications(page);
  await page.getByRole('link', { name: /^Журнал доставки/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал доставки' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Попытки отправки' }).getByRole('listitem'),
  ).toHaveCount(2);
  await checkApp(page, info, 'desktop-notifications-log');
});
