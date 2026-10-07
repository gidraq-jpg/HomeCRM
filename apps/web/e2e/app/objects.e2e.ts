import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { plain, setScope, widthOf } from '../support/helpers.ts';
import {
  apiAs,
  expectNothingStored,
  objectLinks,
  openAs,
  openHome,
  seedNote,
  seedObject,
} from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Объекты (R0.5c): OBJ-1…3, SPACE-5…7, TPL-4. Семья вымышленная: Анна — администратор,
// Борис — взрослый, Вера — ребёнок. Объекты заводятся через API, а проверяются на экране.

const toast = (page: Page) => page.locator('.toast-region');
const form = (page: Page) => page.locator('form.object-form');

async function openCard(page: Page, title: string) {
  await objectLinks(page).filter({ hasText: title }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}

test('пустой «Дом» объясняет разницу личного и общего и предлагает первое действие', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/home');
  const empty = page.getByRole('region', { name: 'Объектов пока нет' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(
    'Недвижимость, машину, технику и другое по умолчанию видят взрослые дома',
  );
  await checkApp(page, info, 'objects-empty');

  await setScope(page, 'Личное');
  await expect(empty).toContainText('Здесь только ваши записи. Их не видит никто, кроме вас.');
  await checkApp(page, info, 'objects-empty-personal');
  await setScope(page, 'Общее');
  await expect(empty).toContainText('Здесь только общие записи дома');
  await empty.getByRole('button', { name: 'Показать «Всё»' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await empty.getByRole('link', { name: 'Добавить объект' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Новый объект' })).toBeVisible();
});

test('создание: «+» → «Объект», «Кто видит» над «Сохранить», недвижимость — «Взрослые»', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить' });
  await expect(dialog.getByRole('button', { name: /^Объект/ })).toBeVisible();
  await checkApp(page, info, 'objects-add-menu');
  await dialog.getByRole('button', { name: /^Объект/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Новый объект' })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // В режиме «Всё» объект «Взрослые» (таблица 7.2); строка «Кто видит» стоит над «Сохранить».
  const visibility = form(page).getByRole('group', { name: 'Кто видит' });
  await expect(visibility.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
  await expect(visibility.getByRole('radio')).toHaveCount(3);
  const box = await visibility.boundingBox();
  const save = await form(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .boundingBox();
  expect(box && save && box.y < save.y).toBe(true);

  // Название обязательно: пустое не сохраняется, ошибка названа.
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('Введите название');
  await expect(page.getByLabel('Название')).toBeFocused();
  await checkApp(page, info, 'objects-form-error');

  await page.getByLabel('Название').fill('Квартира у парка');
  await form(page).getByRole('radio', { name: 'Недвижимость' }).check();
  await checkApp(page, info, 'objects-form');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Объект сохранён');
  await expect(toast(page)).toContainText('Кто видит: Взрослые');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();

  const stored = await family.database.admin.query(
    'SELECT space_kind, audience, object_type FROM objects',
  );
  expect(stored.rows).toEqual([
    { space_kind: 'household', audience: 'adults', object_type: 'property' },
  ]);
});

test('режим «Личное» создаёт личный объект; ребёнку доступно только «Только я»', async ({
  page,
  family,
  browser,
}, info) => {
  await signInAs(page, family, 'adult');
  await setScope(page, 'Личное');
  await page.goto('#/home/new');
  await expect(
    form(page).getByRole('group', { name: 'Кто видит' }).getByRole('radio', { name: 'Только я' }),
  ).toBeChecked();
  await page.getByLabel('Название').fill('Велосипед');
  await form(page).getByRole('radio', { name: 'Другое' }).check();
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Велосипед' })).toBeVisible();
  const stored = await family.database.admin.query('SELECT space_kind, audience FROM objects');
  expect(stored.rows).toEqual([{ space_kind: 'personal', audience: null }]);

  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto('#/home/new');
    const group = form(vera.page).getByRole('group', { name: 'Кто видит' });
    await expect(group.getByRole('radio')).toHaveCount(1);
    await expect(group.getByRole('radio', { name: 'Только я' })).toBeChecked();
    await expect(vera.page.getByText('Общие объекты создают взрослые')).toBeVisible();
    await checkApp(vera.page, info, 'objects-form-child');
  } finally {
    await vera.close();
  }
});

test('список по типам, значок и подпись «Кто видит», фильтр «Всё · Общее · Личное»', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedObject(boris, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'adults',
  });
  await seedObject(boris, family, {
    title: 'Семейная машина',
    objectType: 'car',
    audience: 'household',
  });
  await seedObject(boris, family, { title: 'Личный велосипед' });
  await seedObject(boris, family, {
    title: 'Холодильник',
    objectType: 'appliance',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  await openHome(page);

  await expect(page.getByText('4 объекта')).toBeVisible();
  for (const group of ['Недвижимость', 'Машины', 'Техника', 'Другое']) {
    await expect(page.getByRole('heading', { level: 2, name: group })).toBeVisible();
  }
  await expect(objectLinks(page)).toHaveCount(4);
  const property = page.getByRole('list', { name: 'Недвижимость' });
  await expect(property).toContainText('Квартира у парка');
  await expect(property.getByRole('img', { name: 'Кто видит: Взрослые' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Другое' })).toContainText('Только я');
  await checkApp(page, info, 'objects-list');

  await setScope(page, 'Личное');
  await expect(objectLinks(page)).toHaveCount(1);
  await expect(objectLinks(page)).toContainText('Личный велосипед');
  await setScope(page, 'Общее');
  await expect(objectLinks(page)).toHaveCount(3);
  await checkApp(page, info, 'objects-list-shared');
});

test('карточка: вкладки на второй строке видны без прокрутки, «Обзор», «Лента», «Файлы»', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка с очень длинным названием для проверки переноса строк в заголовке',
    objectType: 'property',
    audience: 'adults',
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Квартира у парка');

  const tabs = page.getByRole('navigation', { name: 'Разделы объекта' });
  await expect(tabs.getByRole('link')).toHaveText(['Обзор', 'Лента', 'Файлы']);
  await expect(tabs.getByRole('link', { name: 'Обзор' })).toHaveAttribute('aria-current', 'page');
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const viewport = page.viewportSize();
  expect(heading && viewport).toBeTruthy();
  for (const name of ['Обзор', 'Лента', 'Файлы']) {
    const box = await tabs.getByRole('link', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    if (!box || !heading || !viewport) continue;
    // Вкладка стоит под названием и целиком в окне: ни прокрутки вбок, ни прокрутки вниз.
    expect(box.y, `${name}: под названием`).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    expect(box.x, `${name}: слева`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name}: справа`).toBeLessThanOrEqual(widthOf(info));
    expect(box.y + box.height, `${name}: без прокрутки вниз`).toBeLessThanOrEqual(viewport.height);
  }
  await expect(page.getByRole('term').filter({ hasText: 'Ответственный' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Вы' }).first()).toBeVisible();
  await checkApp(page, info, 'objects-card');

  await tabs.getByRole('link', { name: 'Файлы' }).click();
  await expect(page.getByRole('region', { name: 'Файлов пока нет' })).toBeVisible();
  await checkApp(page, info, 'objects-files');
  await tabs.getByRole('link', { name: 'Лента' }).click();
  await expect(tabs.getByRole('link', { name: 'Лента' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('list', { name: 'Лента объекта' })).toContainText('Объект создан');
});

test('свои поля: добавить, изменить, удалить; конфликт версий предлагает обновить или сохранить копией', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    fields: [{ name: 'Площадь', value: '54 м²' }],
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}`);
  await expect(page.getByRole('term').filter({ hasText: 'Площадь' })).toBeVisible();

  await page.getByRole('button', { name: 'Править' }).click();
  await expect(page.getByLabel('Поле 1: название')).toHaveValue('Площадь');
  await page.getByRole('button', { name: 'Добавить поле' }).click();
  await page.getByLabel('Поле 2: название').fill('Этаж');
  await page.getByLabel('Поле 2: значение').fill('3');
  await page.getByRole('button', { name: 'Добавить поле' }).click();
  await page.getByLabel('Поле 3: значение').fill('без названия');
  // Значение без названия не сохраняется, строка названа.
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('нет названия');
  await checkApp(page, info, 'objects-fields-edit');
  await page.getByRole('button', { name: 'Поле 3: удалить' }).click();
  await page.getByLabel('Поле 1: значение').fill('55 м²');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Объект сохранён');
  const facts = page.locator('.facts--fields');
  await expect(facts.getByRole('term')).toHaveText(['Площадь', 'Этаж']);
  await expect(facts.getByRole('definition')).toHaveText(['55 м²', '3']);
  await checkApp(page, info, 'objects-fields');

  // Удаление поля: оно уходит из карточки, в базе — в корзину.
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByRole('button', { name: 'Поле 2: удалить' }).click();
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(facts.getByRole('term')).toHaveText(['Площадь']);
  const stored = await family.database.admin.query(
    'SELECT title, deleted_at IS NOT NULL AS trashed FROM object_fields ORDER BY title',
  );
  expect(stored.rows).toEqual([
    { title: 'Площадь', trashed: false },
    { title: 'Этаж', trashed: true },
  ]);

  // Конфликт: пока Борис правит, объект изменили из другого места.
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Квартира у парка, 2 этаж');
  const current = await boris.get(`objects/${flat.id}`);
  const version = (current.body as { updatedAt: string }).updatedAt;
  const changed = await boris.patch(`objects/${flat.id}`, {
    title: 'Квартира, правка с другого устройства',
    expectedUpdatedAt: version,
  });
  expect(changed.status).toBe(200);
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Объект изменили, пока вы его правили.').first()).toBeVisible();
  await checkApp(page, info, 'objects-conflict');
  await page.getByRole('button', { name: 'Сохранить мою версию как копию' }).click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Квартира у парка, 2 этаж (моя версия)',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.facts--fields').getByRole('term')).toHaveText(['Площадь']);
  // Свежая версия осталась как была.
  const titles = await family.database.admin.query('SELECT title FROM objects');
  expect(titles.rows.map((row) => row.title).sort()).toEqual(
    ['Квартира у парка, 2 этаж (моя версия)', 'Квартира, правка с другого устройства'].sort(),
  );
  await expectNothingStored(page, ['Квартира у парка', 'Площадь', '55 м²']);
});

test('лента: ручное событие с суммой в рублях и оценкой, правка и корзина своего события', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}/timeline`);
  const feed = page.getByRole('list', { name: 'Лента объекта' });
  await expect(feed).toContainText('Объект создан');
  await checkApp(page, info, 'objects-timeline');

  await page.getByRole('button', { name: 'Добавить событие' }).click();
  const events = page.locator('form.event-form');
  // Текст обязателен, сумма — число не больше чем с двумя знаками после запятой.
  await events.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(events.getByRole('alert')).toContainText('Опишите событие');
  await events.getByLabel('Что произошло').fill('Заменили смеситель на кухне');
  await events.getByLabel('Дата').fill('2026-10-02');
  await events.getByLabel('Сумма, ₽ (необязательно)').fill('1 840,505');
  await events.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(events.getByRole('alert')).toContainText('Введите сумму числом');
  await events.getByLabel('Сумма, ₽ (необязательно)').fill('1 840,50');
  await events.getByRole('radio', { name: '4', exact: true }).check();
  await checkApp(page, info, 'objects-event-form');
  await events.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(toast(page)).toContainText('Событие добавлено');

  const item = feed.getByRole('listitem').filter({ hasText: 'Заменили смеситель' });
  const text = plain(await item.innerText());
  expect(text).toContain('2 окт.');
  expect(text).toContain('1 840,50 ₽');
  expect(text).toContain('Оценка: 4 из 5');
  await checkApp(page, info, 'objects-timeline-event');
  const stored = await family.database.admin.query(
    'SELECT amount_kopecks::int AS amount, rating, occurred_on::text AS day FROM object_events',
  );
  expect(stored.rows).toEqual([{ amount: 184_050, rating: 4, day: '2026-10-02' }]);

  // Правка своего события: текст меняется, сумма очищается.
  await item.getByRole('button', { name: 'Править' }).click();
  await expect(events.getByLabel('Сумма, ₽ (необязательно)')).toHaveValue('1840,50');
  await events.getByLabel('Что произошло').fill('Заменили смеситель и сифон');
  await events.getByLabel('Сумма, ₽ (необязательно)').fill('');
  await checkApp(page, info, 'objects-event-edit');
  await events.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Событие сохранено');
  const edited = feed.getByRole('listitem').filter({ hasText: 'Заменили смеситель и сифон' });
  await expect(edited).toBeVisible();
  await expect(edited).not.toContainText('₽');
  await expect(edited).toContainText('Оценка: 4 из 5');

  // Корзина события: отмена за 7 секунд возвращает его, без отмены оно остаётся в корзине.
  await edited.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Событие в корзине');
  await expect(edited).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Событие возвращено');
  await expect(edited).toBeVisible();
  await edited.getByRole('button', { name: 'В корзину' }).click();
  await expect(edited).toHaveCount(0);
  const trashed = await family.database.admin.query(
    'SELECT amount_kopecks IS NULL AS no_amount, deleted_at IS NOT NULL AS trashed FROM object_events',
  );
  expect(trashed.rows).toEqual([{ no_amount: true, trashed: true }]);
});

test('связи: объект и заметка связываются, связь видна в обеих карточках, убрать можно с отменой', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await seedNote(boris, family, { title: 'Смета ремонта', body: 'Плитка и краска.' });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}`);
  await expect(page.getByText('Связей пока нет')).toBeVisible();

  await page.getByRole('button', { name: 'Связать…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Связать с записью' });
  const pick = dialog.getByRole('button', { name: /Смета ремонта/ });
  await expect(pick).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Связать', exact: true })).toBeDisabled();
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('Подпись связи (необязательно)').fill('Смета');
  await checkApp(page, info, 'objects-link-sheet');
  await dialog.getByRole('button', { name: 'Связать', exact: true }).click();
  await expect(toast(page)).toContainText('Записи связаны');
  await expect(dialog).toHaveCount(0);
  const links = page.getByRole('list', { name: 'Связанные записи' });
  await expect(links).toContainText('Смета ремонта');
  await expect(links).toContainText('Смета');
  await checkApp(page, info, 'objects-links');

  // В карточке заметки — та же связь, с названием объекта.
  // Сообщение «Записи связаны» ещё закрывает строку, поэтому переходим с клавиатуры.
  await links.getByRole('link', { name: /Смета ремонта/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Смета ремонта' })).toBeVisible();
  const back = page.getByRole('list', { name: 'Связанные записи' });
  await expect(back).toContainText('Квартира у парка');
  await expect(back).toContainText('Смета');
  await checkApp(page, info, 'notes-card-links');

  // Убрать связь: отмена за 7 секунд возвращает её.
  await back.getByRole('button', { name: 'Убрать связь' }).click();
  await expect(toast(page)).toContainText('Связь убрана');
  await expect(page.getByText('Связей пока нет')).toBeVisible();
  await toast(page).getByRole('button', { name: 'Вернуть' }).click();
  await expect(toast(page)).toContainText('Связь возвращена');
  await expect(page.getByRole('list', { name: 'Связанные записи' })).toContainText(
    'Квартира у парка',
  );
  // Уже связанную запись второй раз предложить нельзя.
  await page.goto(`#/home/${flat.id}`);
  await page.getByRole('button', { name: 'Связать…' }).click();
  await expect(page.getByRole('dialog', { name: 'Связать с записью' })).toContainText(
    'Нет записей, которые можно связать',
  );
});

test('четыре действия: «Поделиться…», «Кто видит…», «Сделать личным…», «Скопировать в личное»', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const dacha = await seedObject(boris, family, { title: 'Дача', objectType: 'property' });
  await signInAs(page, family, 'adult');
  const anna = await openAs(browser, family, info, 'admin');
  const vera = await openAs(browser, family, info, 'child');
  try {
    await page.goto(`#/home/${dacha.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Дача' })).toBeVisible();
    for (const hidden of ['Кто видит…', 'Сделать личным…', 'Скопировать в личное']) {
      await expect(page.getByRole('button', { name: hidden }), hidden).toHaveCount(0);
    }

    // «Поделиться…»: личный объект становится общим для всей семьи.
    await page.getByRole('button', { name: 'Поделиться…' }).click();
    const share = page.getByRole('dialog', { name: 'Поделиться объектом' });
    await expect(share.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await share.getByRole('radio', { name: 'Вся семья' }).check();
    await checkApp(page, info, 'objects-share');
    await share.getByRole('button', { name: 'Поделиться', exact: true }).click();
    await expect(toast(page)).toContainText('Объект стал общим');
    await expect(toast(page)).toContainText('Кто видит: Вся семья');
    await expect(page.getByRole('button', { name: 'Поделиться…' })).toHaveCount(0);
    await checkApp(page, info, 'objects-card-shared');

    // Ребёнок видит общий объект, но не меняет его; ему доступна копия в личное.
    await openHome(vera.page);
    await expect(objectLinks(vera.page)).toHaveCount(1);
    await openCard(vera.page, 'Дача');
    for (const hidden of [
      'Править',
      'В корзину',
      'Сделать личным…',
      'Кто видит…',
      'Поделиться…',
      'Добавить поле',
    ]) {
      await expect(vera.page.getByRole('button', { name: hidden }), hidden).toHaveCount(0);
    }
    await expect(vera.page.getByRole('button', { name: 'Скопировать в личное' })).toBeVisible();
    await expect(vera.page.getByText('могут править только взрослые')).toBeVisible();
    await checkApp(vera.page, info, 'objects-card-child');

    // «Скопировать в личное»: у Анны появляется своя копия, исходный объект не меняется.
    await anna.page.goto(`#/home/${dacha.id}`);
    await anna.page.getByRole('button', { name: 'Скопировать в личное' }).click();
    await expect(toast(anna.page)).toContainText('Копия сохранена в личном');
    await toast(anna.page).getByRole('button', { name: 'Открыть' }).click();
    await expect(anna.page.getByRole('heading', { level: 1, name: 'Дача' })).toBeVisible();
    await expect(anna.page.getByText('Только я', { exact: true }).first()).toBeVisible();
    await expect(anna.page.getByRole('button', { name: 'Поделиться…' })).toBeVisible();
    const objects = await family.database.admin.query('SELECT space_kind FROM objects');
    expect(objects.rows.map((row) => row.space_kind).sort()).toEqual(['household', 'personal']);

    // «Кто видит…»: сужение до «Взрослых» сначала называет тех, кто потеряет доступ.
    await page.getByRole('button', { name: 'Кто видит…' }).click();
    const audience = page.getByRole('dialog', { name: 'Кто видит объект' });
    await expect(audience.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await expect(audience.getByRole('alert')).toContainText('Доступ потеряют: Вера');
    await checkApp(page, info, 'objects-audience-preview');
    await audience.getByRole('button', { name: 'Сузить доступ' }).click();
    await expect(toast(page)).toContainText('Объект видят взрослые');
    await openHome(vera.page);
    await expect(vera.page.getByRole('region', { name: 'Объектов пока нет' })).toBeVisible();
    await vera.page.goto(`#/home/${dacha.id}`);
    await expect(
      vera.page.getByText('Объекта больше нет, или он стал вам недоступен'),
    ).toBeVisible();

    // «Сделать личным…»: Борис — автор, чужих правок нет; Анна теряет доступ.
    await page.getByRole('button', { name: 'Сделать личным…' }).click();
    const personal = page.getByRole('dialog', { name: 'Сделать объект личным' });
    await expect(personal.getByRole('alert')).toContainText('Доступ потеряют: Анна');
    await checkApp(page, info, 'objects-personal-preview');
    await personal.getByRole('button', { name: 'Сделать личным', exact: true }).click();
    await expect(toast(page)).toContainText('Объект стал личным');
    await expect(page.getByRole('button', { name: 'Поделиться…' })).toBeVisible();
    await openHome(anna.page);
    // У Анны остаётся только её копия.
    await expect(objectLinks(anna.page)).toHaveCount(1);
    const left = await family.database.admin.query(
      'SELECT space_kind, audience FROM objects ORDER BY created_at',
    );
    expect(left.rows).toEqual([
      { space_kind: 'personal', audience: null },
      { space_kind: 'personal', audience: null },
    ]);
  } finally {
    await anna.close();
    await vera.close();
  }
});

test('корзина: отмена за 7 секунд, восстановление возвращает поля и события', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const old = await seedObject(boris, family, {
    title: 'Старый холодильник',
    objectType: 'appliance',
    audience: 'household',
    fields: [{ name: 'Модель', value: 'А-1' }],
  });
  const event = await boris.post(`objects/${old.id}/events`, {
    occurredOn: '2026-09-20',
    text: 'Ремонт мотора',
    amountKopecks: 450_000,
  });
  expect(event.status).toBe(201);
  await signInAs(page, family, 'adult');
  await page.goto('#/more/trash');
  await expect(page.getByRole('region', { name: 'В корзине пусто' })).toBeVisible();
  await expect(page.getByText('хранятся здесь 30 дней')).toBeVisible();
  await checkApp(page, info, 'objects-trash-empty');

  await openHome(page);
  await openCard(page, 'Старый холодильник');
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
  await expect(toast(page)).toContainText('Объект в корзине');
  await expect(toast(page)).toContainText('Хранится 30 дней');
  await expect(page.getByRole('region', { name: 'Объектов пока нет' })).toBeVisible();
  // Отмена в течение 7 секунд возвращает объект на место.
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Объект возвращён');
  await expect(objectLinks(page)).toHaveCount(1);

  // Второй раз — не отменяем: объект остаётся в корзине.
  await openCard(page, 'Старый холодильник');
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Объект в корзине');
  await page.goto('#/more/trash');
  const row = page.getByRole('list', { name: 'Удалённые объекты' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Старый холодильник');
  await expect(row).toContainText('хранится до');
  await checkApp(page, info, 'objects-trash');
  await row.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Объект возвращён');
  await expect(page.getByRole('region', { name: 'В корзине пусто' })).toBeVisible();

  // Вместе с объектом вернулись и поля, и события.
  await page.goto(`#/home/${old.id}`);
  await expect(page.locator('.facts--fields').getByRole('term')).toHaveText(['Модель']);
  await page.getByRole('link', { name: 'Лента', exact: true }).click();
  const item = page.getByRole('list', { name: 'Лента объекта' }).getByRole('listitem');
  await expect(item.filter({ hasText: 'Ремонт мотора' })).toBeVisible();
  expect(plain(await item.filter({ hasText: 'Ремонт мотора' }).innerText())).toContain('4 500 ₽');
  const restored = await family.database.admin.query(
    `SELECT (SELECT deleted_at IS NULL FROM objects) AS object_live,
            (SELECT bool_and(deleted_at IS NULL) FROM object_fields) AS fields_live,
            (SELECT bool_and(deleted_at IS NULL) FROM object_events) AS events_live`,
  );
  expect(restored.rows).toEqual([{ object_live: true, fields_live: true, events_live: true }]);
});

test('чужое личное и «Взрослые» не попадают ни в списки, ни в связи, ни в ленту', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const lease = await seedObject(boris, family, { title: 'Договор аренды', audience: 'adults' });
  const idea = await seedObject(boris, family, { title: 'Личная задумка' });
  const memo = await seedNote(boris, family, { title: 'Общая памятка', audience: 'household' });
  const draft = await seedNote(boris, family, { title: 'Личный черновик' });
  const linked = await boris.post('links', {
    left: { type: 'object', id: lease.id },
    right: { type: 'note', id: memo.id },
    role: 'Памятка жильцам',
  });
  expect(linked.status).toBe(201);
  const call = await boris.post(`objects/${lease.id}/events`, {
    occurredOn: '2026-10-01',
    text: 'Звонок юристу',
    contact: { type: 'note', id: draft.id },
  });
  expect(call.status).toBe(201);

  await signInAs(page, family, 'adult');
  const anna = await openAs(browser, family, info, 'admin');
  const vera = await openAs(browser, family, info, 'child');
  try {
    // Борис видит всё своё: связь в карточке заметки и свой личный контакт в ленте.
    await page.goto(`#/more/notes/${memo.id}`);
    await expect(page.getByRole('list', { name: 'Связанные записи' })).toContainText(
      'Договор аренды',
    );
    await page.goto(`#/home/${lease.id}/timeline`);
    await expect(page.getByText('Контакт:')).toContainText('Личный черновик');

    // Администратор видит «Взрослых», но не чужое личное; чужой личный контакт события скрыт.
    await openHome(anna.page);
    await expect(objectLinks(anna.page)).toHaveCount(1);
    await expect(anna.page.getByText('Личная задумка')).toHaveCount(0);
    await anna.page.goto(`#/home/${idea.id}`);
    await expect(
      anna.page.getByText('Объекта больше нет, или он стал вам недоступен'),
    ).toBeVisible();
    await anna.page.goto(`#/home/${lease.id}/timeline`);
    const annaFeed = anna.page.getByRole('list', { name: 'Лента объекта' });
    await expect(annaFeed).toContainText('Звонок юристу');
    await expect(anna.page.getByText('Контакт')).toHaveCount(0);
    await expect(anna.page.getByText('Личный черновик')).toHaveCount(0);
    // Чужое событие она не правит и не убирает в корзину.
    await expect(annaFeed.getByRole('button', { name: 'Править' })).toHaveCount(0);
    await expect(annaFeed.getByRole('button', { name: 'В корзину' })).toHaveCount(0);
    await checkApp(anna.page, info, 'objects-timeline-contact-hidden');

    // Ребёнок не видит «Взрослых» ни в «Доме», ни в связях общей заметки.
    await openHome(vera.page);
    await expect(vera.page.getByRole('region', { name: 'Объектов пока нет' })).toBeVisible();
    await vera.page.goto(`#/home/${lease.id}`);
    await expect(
      vera.page.getByText('Объекта больше нет, или он стал вам недоступен'),
    ).toBeVisible();
    await vera.page.goto(`#/more/notes/${memo.id}`);
    await expect(vera.page.getByRole('heading', { level: 1, name: 'Общая памятка' })).toBeVisible();
    await expect(vera.page.getByText('Связей пока нет')).toBeVisible();
    await expect(vera.page.getByText('Договор аренды')).toHaveCount(0);
    await expect(vera.page.getByText('Памятка жильцам')).toHaveCount(0);
    await checkApp(vera.page, info, 'notes-card-links-child');

    // В хранилищах браузера нет ни названий, ни текстов.
    await expectNothingStored(page, ['Договор аренды', 'Личная задумка', 'Звонок юристу']);
    await expectNothingStored(vera.page, ['Договор аренды', 'Общая памятка']);
  } finally {
    await anna.close();
    await vera.close();
  }
});
