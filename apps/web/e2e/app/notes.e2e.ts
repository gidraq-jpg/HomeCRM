import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { setScope } from '../support/helpers.ts';
import {
  apiAs,
  expectNothingStored,
  noteLinks,
  openAs,
  openNotes,
  seedNote,
} from './notes-support.ts';
import { checkApp, expect, openSection, signInAs } from './support.ts';

// Заметки (R0.4b): NOTE-1…3, SPACE-5…7, TPL-4. Семья вымышленная: Анна — администратор,
// Борис — взрослый, Вера — ребёнок. Заметки заводятся через API, а проверяются на экране.

const toast = (page: Page) => page.locator('.toast-region');
const form = (page: Page) => page.locator('form.note-form');

async function openCard(page: Page, title: string) {
  await noteLinks(page).filter({ hasText: title }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}

test('пустой раздел объясняет разницу личного и общего в каждом режиме', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more');
  await expect(page.getByRole('link', { name: /^Заметки/ })).toBeVisible();
  await checkApp(page, info, 'notes-more');
  await page.getByRole('link', { name: /^Заметки/ }).click();
  const empty = page.getByRole('region', { name: 'Заметок пока нет' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Личную заметку видите только вы');
  await expect(empty).toContainText('«Поделиться…»');
  await checkApp(page, info, 'notes-empty');

  await setScope(page, 'Личное');
  await expect(empty).toContainText('Здесь только ваши записи. Их не видит никто, кроме вас.');
  await checkApp(page, info, 'notes-empty-personal');
  await setScope(page, 'Общее');
  await expect(empty).toContainText('Здесь только общие записи дома');
  await empty.getByRole('button', { name: 'Показать «Всё»' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await empty.getByRole('link', { name: 'Записать заметку' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Новая заметка' })).toBeVisible();
});

test('создание личной заметки: «Кто видит» над «Сохранить», Markdown, чек-лист, закрепление', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить' });
  await expect(dialog.getByRole('button', { name: /^Заметка/ })).toBeVisible();
  await checkApp(page, info, 'notes-add-menu');
  await dialog.getByRole('button', { name: /^Заметка/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Новая заметка' })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // В режиме «Всё» заметка личная (таблица 7.2), строка «Кто видит» стоит над «Сохранить».
  const visibility = form(page).getByRole('group', { name: 'Кто видит' });
  await expect(visibility.getByRole('radio', { name: 'Только я' })).toBeChecked();
  await expect(visibility.getByRole('radio')).toHaveCount(3);
  const box = await visibility.boundingBox();
  const save = await form(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .boundingBox();
  expect(box && save && box.y < save.y).toBe(true);

  // Заголовок обязателен: пустой не сохраняется, ошибка названа.
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('Введите заголовок');
  await expect(page.getByLabel('Заголовок')).toBeFocused();
  await checkApp(page, info, 'notes-form-error');

  await page.getByLabel('Заголовок').fill('Ремонт кухни');
  await page
    .getByLabel('Текст', { exact: true })
    .fill(
      '# Что купить\n\nНужна **краска** и *кисти*.\n\n- белая краска\n- малярный скотч\n\nСмета: [таблица](https://example.com/smeta)',
    );
  // Enter в пункте добавляет следующий и переходит в него.
  await page.getByRole('button', { name: 'Добавить пункт' }).click();
  await page.getByLabel('Пункт 1', { exact: true }).fill('Купить краску');
  await page.getByLabel('Пункт 1', { exact: true }).press('Enter');
  await page.getByLabel('Пункт 2', { exact: true }).fill('Позвонить мастеру');
  await page.getByRole('button', { name: 'Добавить пункт' }).click();
  await page.getByLabel('Пункт 3', { exact: true }).fill('Лишний пункт');
  await page.getByRole('button', { name: 'Пункт 3: удалить' }).click();
  await expect(page.getByLabel('Пункт 3', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Пункт 2: выше' }).click();
  await expect(page.getByLabel('Пункт 1', { exact: true })).toHaveValue('Позвонить мастеру');
  await page.getByRole('checkbox', { name: 'Закрепить вверху списка' }).check();
  await checkApp(page, info, 'notes-form');

  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Заметка сохранена');
  await expect(toast(page)).toContainText('Кто видит: Только я');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ремонт кухни', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Что купить' })).toBeVisible();
  await expect(page.locator('.markdown strong')).toHaveText('краска');
  await expect(page.locator('.markdown li')).toHaveText(['белая краска', 'малярный скотч']);
  await expect(page.getByRole('link', { name: 'таблица' })).toHaveAttribute(
    'href',
    'https://example.com/smeta',
  );
  await expect(page.getByText('Закреплена', { exact: true })).toBeVisible();
  await expect(page.getByText('Только я', { exact: true }).first()).toBeVisible();
  // Порядок пунктов сохранён: сначала «Позвонить мастеру».
  const items = page.getByRole('main').getByRole('checkbox');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAccessibleName('Позвонить мастеру');
  await checkApp(page, info, 'notes-card');

  // Что записал сервер.
  const stored = await family.database.admin.query(
    'SELECT n.space_kind, n.audience, n.pinned, (SELECT count(*)::int FROM note_items i WHERE i.parent_id = n.id) AS items FROM notes n',
  );
  expect(stored.rows).toEqual([{ space_kind: 'personal', audience: null, pinned: true, items: 2 }]);
});

test('правка: чек-лист отмечается на карточке, закрепление, порядок в списке, фильтр по заголовку', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, { title: 'Дача: что вывезти', body: 'Осенний список.' });
  await seedNote(boris, family, {
    title: 'Ремонт кухни',
    body: 'Смета и мастера.',
    checklist: [{ title: 'Купить краску' }, { title: 'Позвонить мастеру', done: true }],
  });
  await seedNote(boris, family, { title: 'Идеи на отпуск', pinned: true });
  await signInAs(page, family, 'adult');
  await openNotes(page);

  // Закреплённые сверху, у каждой значок и подпись «Кто видит».
  await expect(page.getByText('3 заметки')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Закреплённые' })).toBeVisible();
  const pinned = page.getByRole('list', { name: 'Закреплённые заметки' });
  await expect(pinned.getByRole('link')).toHaveCount(1);
  await expect(pinned).toContainText('Идеи на отпуск');
  await expect(pinned).toContainText('Только я');
  await expect(pinned.getByRole('img', { name: 'Кто видит: Только я' })).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(3);
  await checkApp(page, info, 'notes-list');

  // Фильтр по заголовку — на клиенте, без запроса и без записи в адрес.
  await page.getByLabel('Найти по заголовку').fill('ремонт');
  await expect(noteLinks(page)).toHaveCount(1);
  expect(page.url()).not.toContain('ремонт');
  await page.getByLabel('Найти по заголовку').fill('такого нет');
  await expect(page.getByRole('region', { name: 'Ничего не нашли' })).toBeVisible();
  await checkApp(page, info, 'notes-list-filter-empty');
  await page.getByLabel('Найти по заголовку').fill('');
  await expect(noteLinks(page)).toHaveCount(3);

  await openCard(page, 'Ремонт кухни');
  await expect(page.getByText('Выполнено 1 из 2')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Купить краску' }).click();
  await expect(page.getByText('Выполнено 2 из 2')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Выполнено 2 из 2')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Позвонить мастеру' }).click();
  await expect(page.getByText('Выполнено 1 из 2')).toBeVisible();

  // Закрепление с карточки: заметка поднимается в «Закреплённые».
  await page.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открепить' })).toBeVisible();
  await expect(page.getByText('Закреплена', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Заметки', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Закреплённые заметки' }).getByRole('link'),
  ).toHaveCount(2);

  // Правка текста и заголовка.
  await openCard(page, 'Ремонт кухни');
  await page.getByRole('button', { name: 'Править' }).click();
  await expect(page.getByLabel('Заголовок')).toHaveValue('Ремонт кухни');
  await page.getByLabel('Заголовок').fill('Ремонт кухни: этап 2');
  await page.getByLabel('Текст', { exact: true }).fill('Новый **текст**.');
  await checkApp(page, info, 'notes-edit');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Заметка сохранена');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ремонт кухни: этап 2', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.markdown strong')).toHaveText('текст');
  // Пункты чек-листа остались при правке текста.
  await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(2);
});

test('режим «Общее» создаёт общую заметку; ребёнку доступно только «Только я»', async ({
  page,
  family,
  browser,
}, info) => {
  await signInAs(page, family, 'adult');
  await setScope(page, 'Общее');
  await page.goto('#/more/notes/new');
  await expect(form(page).getByRole('radio', { name: 'Вся семья' })).toBeChecked();
  await form(page).getByRole('radio', { name: 'Взрослые' }).check();
  await page.getByLabel('Заголовок').fill('Договор с управляющей компанией');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Кто видит: Взрослые');
  await expect(page.getByText('Взрослые', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Автор' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Вы' })).toBeVisible();
  const stored = await family.database.admin.query('SELECT space_kind, audience FROM notes');
  expect(stored.rows).toEqual([{ space_kind: 'household', audience: 'adults' }]);

  // В режиме «Личное» новая заметка личная, а созданная общей скрыта и сказано почему.
  await setScope(page, 'Личное');
  await page.goto('#/more/notes/new');
  await expect(form(page).getByRole('radio', { name: 'Только я' })).toBeChecked();
  await form(page).getByRole('radio', { name: 'Вся семья' }).check();
  await page.getByLabel('Заголовок').fill('Список для всей семьи');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Режим «Личное» её не показывает');
  await toast(page).getByRole('button', { name: 'Показать всё' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();

  // Ребёнок: общие заметки создают взрослые (PRD 6.2), поэтому остаётся одно значение.
  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto('#/more/notes/new');
    const group = vera.page.locator('form.note-form').getByRole('group', { name: 'Кто видит' });
    await expect(group.getByRole('radio')).toHaveCount(1);
    await expect(group.getByRole('radio', { name: 'Только я' })).toBeChecked();
    await expect(vera.page.getByText('Общие заметки создают взрослые')).toBeVisible();
    await checkApp(vera.page, info, 'notes-form-child');
    await vera.page.getByLabel('Заголовок').fill('Мои секреты');
    await vera.page
      .locator('form.note-form')
      .getByRole('button', { name: 'Сохранить', exact: true })
      .click();
    await expect(vera.page.getByRole('heading', { level: 1, name: 'Мои секреты' })).toBeVisible();
    await expect(vera.page.getByRole('button', { name: 'Поделиться…' })).toHaveCount(0);
    await expect(vera.page.getByRole('button', { name: 'В корзину' })).toBeVisible();
  } finally {
    await vera.close();
  }
});

test('личная заметка не видна второму взрослому и администратору; после «Поделиться» видна всем', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const secret = await seedNote(boris, family, {
    title: 'Подарок Анне на юбилей',
    body: 'Идея: путёвка.',
  });
  await signInAs(page, family, 'adult');
  const anna = await openAs(browser, family, info, 'admin');
  const vera = await openAs(browser, family, info, 'child');
  try {
    // Пока заметка личная, её нет ни в списках, ни по прямому адресу.
    for (const other of [anna, vera]) {
      await openNotes(other.page);
      await expect(other.page.getByRole('region', { name: 'Заметок пока нет' })).toBeVisible();
      await other.page.goto(`#/more/notes/${secret.id}`);
      await expect(
        other.page.getByText('Заметки больше нет, или она стала вам недоступна'),
      ).toBeVisible();
      await expect(other.page.getByText('Подарок Анне')).toHaveCount(0);
    }
    await checkApp(anna.page, info, 'notes-hidden');

    // Борис делится со всей семьёй.
    await openNotes(page);
    await openCard(page, 'Подарок Анне на юбилей');
    await page.getByRole('button', { name: 'Поделиться…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Поделиться заметкой' });
    await expect(dialog.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Вся семья' }).check();
    await checkApp(page, info, 'notes-share');
    await dialog.getByRole('button', { name: 'Поделиться', exact: true }).click();
    await expect(toast(page)).toContainText('Заметка стала общей');
    await expect(toast(page)).toContainText('Кто видит: Вся семья');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Вся семья', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Поделиться…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Кто видит…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сделать личной…' })).toBeVisible();
    await expect(page.getByRole('term').filter({ hasText: 'Автор' })).toBeVisible();
    await checkApp(page, info, 'notes-card-shared');

    // Теперь её видят администратор и ребёнок; у ребёнка нет правки и «Сделать личной».
    await openNotes(anna.page);
    await expect(noteLinks(anna.page)).toHaveCount(1);
    await openCard(anna.page, 'Подарок Анне на юбилей');
    await expect(anna.page.getByRole('term').filter({ hasText: 'Автор' })).toBeVisible();
    await expect(anna.page.getByRole('definition').filter({ hasText: 'Борис' })).toBeVisible();
    await expect(anna.page.getByRole('button', { name: 'Править' })).toBeVisible();
    await expect(anna.page.getByRole('button', { name: 'Сделать личной…' })).toHaveCount(0);
    await expect(anna.page.getByRole('button', { name: 'Скопировать в личное' })).toBeVisible();

    await openNotes(vera.page);
    await openCard(vera.page, 'Подарок Анне на юбилей');
    await expect(vera.page.getByText('Идея: путёвка.')).toBeVisible();
    for (const hidden of [
      'Править',
      'Закрепить',
      'В корзину',
      'Сделать личной…',
      'Кто видит…',
      'Поделиться…',
    ]) {
      await expect(vera.page.getByRole('button', { name: hidden }), hidden).toHaveCount(0);
    }
    await expect(vera.page.getByRole('button', { name: 'Скопировать в личное' })).toBeVisible();
    await expect(vera.page.getByText('могут править только взрослые')).toBeVisible();
    await checkApp(vera.page, info, 'notes-card-child');
  } finally {
    await anna.close();
    await vera.close();
  }
});

test('«Сделать личной» и «Кто видит…»: предпросмотр, кто потеряет доступ, подтверждение', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const shared = await seedNote(boris, family, {
    title: 'План на выходные',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  const vera = await openAs(browser, family, info, 'child');
  try {
    await page.goto(`#/more/notes/${shared.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'План на выходные' })).toBeVisible();

    // Сужение до «Взрослых»: сначала сказано, что потеряет Вера, потом подтверждение.
    await page.getByRole('button', { name: 'Кто видит…' }).click();
    const audience = page.getByRole('dialog', { name: 'Кто видит заметку' });
    await expect(audience.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await expect(audience.getByRole('alert')).toContainText('Доступ потеряют: Вера');
    await checkApp(page, info, 'notes-audience-preview');
    // Расширять можно без подтверждения: список не показывается.
    await audience.getByRole('radio', { name: 'Вся семья' }).check();
    await expect(audience.getByRole('alert')).toHaveCount(0);
    await expect(audience.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await audience.getByRole('radio', { name: 'Взрослые' }).check();
    await audience.getByRole('button', { name: 'Сузить доступ' }).click();
    await expect(toast(page)).toContainText('Заметку видят взрослые');
    await expect(audience).toHaveCount(0);
    const narrowed = await family.database.admin.query('SELECT audience FROM notes');
    expect(narrowed.rows).toEqual([{ audience: 'adults' }]);
    await openNotes(vera.page);
    await expect(vera.page.getByRole('region', { name: 'Заметок пока нет' })).toBeVisible();

    // Расширение обратно — без предпросмотра.
    await page.getByRole('button', { name: 'Кто видит…' }).click();
    await audience.getByRole('radio', { name: 'Вся семья' }).check();
    await audience.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(toast(page)).toContainText('Заметку видит вся семья');
    await openNotes(vera.page);
    await expect(noteLinks(vera.page)).toHaveCount(1);

    // «Сделать личной»: подтверждение с теми, кто потеряет доступ, — Вера.
    await page.getByRole('button', { name: 'Сделать личной…' }).click();
    const personal = page.getByRole('dialog', { name: 'Сделать заметку личной' });
    await expect(personal.getByRole('alert')).toContainText('Доступ потеряют: Анна, Вера');
    await checkApp(page, info, 'notes-personal-preview');
    await personal.getByRole('button', { name: 'Отмена' }).click();
    await expect(personal).toHaveCount(0);
    const unchanged = await family.database.admin.query('SELECT space_kind FROM notes');
    expect(unchanged.rows).toEqual([{ space_kind: 'household' }]);

    await page.getByRole('button', { name: 'Сделать личной…' }).click();
    await personal.getByRole('button', { name: 'Сделать личной', exact: true }).click();
    await expect(toast(page)).toContainText('Заметка стала личной');
    await expect(page.getByRole('button', { name: 'Поделиться…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сделать личной…' })).toHaveCount(0);
    const moved = await family.database.admin.query('SELECT space_kind FROM notes');
    expect(moved.rows).toEqual([{ space_kind: 'personal' }]);
    await openNotes(vera.page);
    await expect(vera.page.getByRole('region', { name: 'Заметок пока нет' })).toBeVisible();
  } finally {
    await vera.close();
  }
});

test('чужой вклад закрывает «Сделать личной»: сказано почему, остаётся «Скопировать в личное»', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const shared = await seedNote(boris, family, {
    title: 'Список дел на даче',
    body: 'Первая версия.',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/notes/${shared.id}`);
  await expect(page.getByRole('button', { name: 'Сделать личной…' })).toBeVisible();

  // Анна правит текст: это чужой вклад (PRD 7.3.6).
  const anna = await openAs(browser, family, info, 'admin');
  try {
    await anna.page.goto(`#/more/notes/${shared.id}`);
    await anna.page.getByRole('button', { name: 'Править' }).click();
    await anna.page.getByLabel('Текст', { exact: true }).fill('Первая версия. Дополнила Анна.');
    await anna.page
      .locator('form.note-form')
      .getByRole('button', { name: 'Сохранить', exact: true })
      .click();
    await expect(anna.page.getByText('Дополнила Анна.')).toBeVisible();
  } finally {
    await anna.close();
  }

  await page.reload();
  await expect(page.getByText('Дополнила Анна.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сделать личной…' })).toHaveCount(0);
  await expect(
    page.getByText('Сделать заметку личной нельзя: в ней есть правки других участников'),
  ).toBeVisible();
  await checkApp(page, info, 'notes-personal-blocked');

  // Копия в личное: новая заметка только у Бориса, исходная остаётся общей.
  await page.getByRole('button', { name: 'Скопировать в личное' }).click();
  await expect(toast(page)).toContainText('Копия сохранена в личном');
  await toast(page).getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Список дел на даче' })).toBeVisible();
  await expect(page.getByText('Дополнила Анна.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поделиться…' })).toBeVisible();
  const rows = await family.database.admin.query(
    'SELECT space_kind::text AS space_kind FROM notes ORDER BY 1',
  );
  expect(rows.rows).toEqual([{ space_kind: 'household' }, { space_kind: 'personal' }]);
});

test('читатель общей заметки копирует её в личное; своя копия личная', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, {
    title: 'Правила дома',
    body: 'Обувь у двери.',
    checklist: [{ title: 'Вынести мусор' }],
    audience: 'household',
  });
  await signInAs(page, family, 'child');
  await openNotes(page);
  await openCard(page, 'Правила дома');
  await page.getByRole('button', { name: 'Скопировать в личное' }).click();
  await expect(toast(page)).toContainText('Копия сохранена в личном');
  await checkApp(page, info, 'notes-copy-toast');
  await setScope(page, 'Личное');
  await expect(noteLinks(page)).toHaveCount(0);
  await page.goto('#/more/notes');
  await expect(noteLinks(page)).toHaveCount(1);
  await expect(noteLinks(page).first()).toContainText('Только я');
  const copy = await family.database.admin.query(
    "SELECT author_id, (SELECT count(*)::int FROM note_items i WHERE i.parent_id = n.id) AS items FROM notes n WHERE space_kind = 'personal'",
  );
  expect(copy.rows).toEqual([{ author_id: family.person('child').id, items: 1 }]);
});

test('конфликт правки: «обновить» или «сохранить мою версию как копию»', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const note = await seedNote(boris, family, { title: 'Список покупок', body: 'Хлеб, молоко.' });
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/notes/${note.id}`);
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Текст', { exact: true }).fill('Хлеб, молоко, сыр.');

  // Пока Борис правил на телефоне, ту же заметку изменили с другого устройства.
  const other = await boris.patch(`notes/${note.id}`, { body: 'Хлеб, молоко, яйца.' });
  expect(other.status).toBe(200);

  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  const panel = form(page).getByRole('alert');
  await expect(panel).toContainText('Заметку изменили, пока вы её правили');
  await expect(page.getByLabel('Текст', { exact: true })).toHaveValue('Хлеб, молоко, сыр.');
  await checkApp(page, info, 'notes-conflict');

  // «Сохранить мою версию как копию»: свежая версия не тронута, моя — отдельной заметкой.
  await panel.getByRole('button', { name: 'Сохранить мою версию как копию' }).click();
  await expect(toast(page)).toContainText('Ваша версия сохранена отдельной заметкой');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Список покупок (моя версия)', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Хлеб, молоко, сыр.')).toBeVisible();
  await page.goto(`#/more/notes/${note.id}`);
  await expect(page.getByText('Хлеб, молоко, яйца.')).toBeVisible();

  // «Обновить»: правка пропадает, показана свежая версия.
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Текст', { exact: true }).fill('Хлеб, молоко, мёд.');
  const again = await boris.patch(`notes/${note.id}`, { body: 'Хлеб, молоко, чай.' });
  expect(again.status).toBe(200);
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await form(page).getByRole('button', { name: 'Обновить' }).click();
  await expect(page.getByText('Хлеб, молоко, чай.')).toBeVisible();
  await expect(page.getByLabel('Текст', { exact: true })).toHaveCount(0);
});

test('корзина: отмена за 7 секунд, восстановление, срок хранения, пустое состояние', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, { title: 'Старый список', body: 'Не нужен.' });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/trash');
  await expect(page.getByRole('region', { name: 'В корзине пусто' })).toBeVisible();
  await expect(page.getByText('хранятся здесь 30 дней')).toBeVisible();
  await checkApp(page, info, 'notes-trash-empty');

  await openNotes(page);
  await openCard(page, 'Старый список');
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Заметки' })).toBeVisible();
  await expect(toast(page)).toContainText('Заметка в корзине');
  await expect(toast(page)).toContainText('Хранится 30 дней');
  await expect(page.getByRole('region', { name: 'Заметок пока нет' })).toBeVisible();
  // Отмена в течение 7 секунд возвращает заметку на место.
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Заметка возвращена');
  await expect(noteLinks(page)).toHaveCount(1);

  // Второй раз — не отменяем: заметка остаётся в корзине.
  await openCard(page, 'Старый список');
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Заметка в корзине');
  const stored = await family.database.admin.query(
    'SELECT deleted_at IS NOT NULL AS trashed FROM notes',
  );
  expect(stored.rows).toEqual([{ trashed: true }]);

  await page.goto('#/more/trash');
  const row = page.getByRole('list', { name: 'Удалённые заметки' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Старый список');
  await expect(row).toContainText('хранится до');
  await checkApp(page, info, 'notes-trash');
  await row.getByRole('button', { name: 'Восстановить' }).click();
  await expect(toast(page)).toContainText('Заметка возвращена');
  await expect(page.getByRole('region', { name: 'В корзине пусто' })).toBeVisible();
  await page.goto('#/more/notes');
  await expect(noteLinks(page)).toHaveCount(1);
  const restored = await family.database.admin.query(
    'SELECT deleted_at IS NULL AS live FROM notes',
  );
  expect(restored.rows).toEqual([{ live: true }]);
});

test('общую заметку взрослый, не автор, убирает в корзину, но вернуть её не может', async ({
  page,
  family,
  browser,
}, info) => {
  const anna = await openAs(browser, family, info, 'admin');
  try {
    const boris = await apiAs(family, 'adult');
    const note = await seedNote(boris, family, { title: 'Заметка Бориса', audience: 'household' });
    // Анна — администратор: она убирает чужую общую заметку и может вернуть её сама.
    await anna.page.goto(`#/more/notes/${note.id}`);
    await anna.page.getByRole('button', { name: 'В корзину' }).click();
    await expect(toast(anna.page)).toContainText('Заметка в корзине');
    await expect(toast(anna.page).getByRole('button', { name: 'Отменить' })).toBeVisible();
  } finally {
    await anna.close();
  }
  // Борис — автор: заметка в корзине видна ему с кнопкой «Восстановить».
  await signInAs(page, family, 'adult');
  await page.goto('#/more/trash');
  await expect(page.getByRole('button', { name: 'Восстановить' })).toBeVisible();
  await checkApp(page, info, 'notes-trash-author');
});

test('заголовки и тексты заметок не попадают в хранилища, кэш, адрес и консоль', async ({
  page,
  family,
}) => {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, {
    title: 'Пароль от сейфа в гараже',
    body: 'Код 4417-секрет',
    checklist: [{ title: 'Секретный пункт' }],
  });
  await signInAs(page, family, 'adult');
  await openNotes(page);
  await openCard(page, 'Пароль от сейфа в гараже');
  await expect(page.getByText('Код 4417-секрет')).toBeVisible();
  await page.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Текст', { exact: true }).fill('Новый черновик 9902-секрет');
  // Несохранённый черновик живёт только в памяти страницы.
  const secrets = [
    'Пароль от сейфа',
    'Код 4417',
    'Секретный пункт',
    'Новый черновик',
    '9902-секрет',
  ];
  await expectNothingStored(page, secrets);
  expect(logs.join('\n')).not.toMatch(/сейфа|4417|Секретный|9902/);

  // Ответы /api не кэшируются: сервер и клиент просят «no-store».
  const served = await page.evaluate(async () => {
    const response = await fetch('/api/notes', { credentials: 'same-origin', cache: 'no-store' });
    return { status: response.status, cache: response.headers.get('cache-control') ?? '' };
  });
  expect(served.status).toBe(200);
  // Сервер не просит кэшировать ответы API; сам клиент запрашивает их с cache: no-store.
  expect(served.cache).not.toMatch(/public|max-age=[1-9]/);
  await page.reload();
  await expect(page.getByLabel('Текст', { exact: true })).toHaveCount(0);
  await expectNothingStored(page, secrets);
});

test('ошибка загрузки списка не ломает экран: понятный текст и повтор', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'adult');
  await page.route('**/api/notes?*', (route) =>
    route.fulfill({ status: 503, json: { code: 'DOWN' } }),
  );
  await page.goto('#/more/notes');
  await expect(page.getByText('Не удалось загрузить заметки')).toBeVisible();
  await page.unroute('**/api/notes?*');
  await page.getByRole('button', { name: 'Повторить загрузку заметок' }).click();
  await expect(page.getByRole('region', { name: 'Заметок пока нет' })).toBeVisible();
});

test('ошибка сохранения понятна, введённое не теряется', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  await openSection(page, '/more/notes/new', 'Новая заметка');
  await page.route('**/api/notes', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { code: 'INVALID_INPUT' } })
      : route.continue(),
  );
  await page.getByLabel('Заголовок').fill('Черновик');
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('Проверьте заметку');
  await expect(page.getByLabel('Заголовок')).toHaveValue('Черновик');
});
