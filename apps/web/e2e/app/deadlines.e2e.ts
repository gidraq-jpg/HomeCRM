import { mock } from 'node:test';
import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { plain, setScope } from '../support/helpers.ts';
import {
  deadlineForm,
  deadlinesSection,
  groupItems,
  homeDate,
  openNoteCard,
  openObjectCard,
  openRadar,
  radarSummary,
  recalc,
  seedDeadline,
  setHomeZone,
} from './deadlines-support.ts';
import {
  apiAs,
  expectNothingStored,
  openAs as openSession,
  seedNote,
  seedObject,
} from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Сроки и радар (R0.8b): DEAD-1, DEAD-3, DEAD-6, заготовка под DEAD-4. Семья вымышленная:
// Анна — администратор, Борис — взрослый, Вера — ребёнок. Записи и сроки заводятся через API,
// наступления пересчитывает вызов обработчика (в сквозном тесте его нет), экран проверяется глазами.

const toast = (page: Page) => page.locator('.toast-region');
const items = (page: Page) => deadlinesSection(page).getByRole('list', { name: 'Сроки записи' });

// Одна дата на сценарий у API, сидирования и браузера: переход через полночь
// во время кликов не меняет «через N дней». Таймеры остаются настоящими.
test.beforeEach(async ({ page }) => {
  const now = Date.now();
  mock.timers.enable({ apis: ['Date'], now });
  await page.clock.setFixedTime(now);
});
test.afterEach(() => {
  mock.timers.reset();
});
async function openAs(...args: Parameters<typeof openSession>) {
  const session = await openSession(...args);
  await session.page.clock.setFixedTime(new Date());
  return session;
}

test('радар: один запрос с названием; ошибка блока не ломает «Сегодня» и повтор восстанавливает радар', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, {
    title: 'Срок проверки котла',
    audience: 'household',
  });
  await seedDeadline(boris, 'objects', object.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  let failed = true;
  const requested: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      requested.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/deadlines?*', (route) =>
    failed
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'INTERNAL_ERROR' }),
        })
      : route.continue(),
  );
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить загрузку срочного' })).toBeVisible();
  await checkApp(page, info, 'today-radar-error');
  await openRadar(page);
  await expect(page.getByRole('button', { name: 'Повторить загрузку радара' })).toBeVisible();
  await checkApp(page, info, 'radar-error');
  requested.length = 0;
  failed = false;
  await page.getByRole('button', { name: 'Повторить загрузку радара' }).click();
  await expect(page.getByRole('list', { name: 'Сейчас', exact: true })).toContainText(
    'Срок проверки котла',
  );
  expect(requested).toEqual(['/api/deadlines']);
  await checkApp(page, info, 'radar-single-request');
});

async function submitDeadline(page: Page, label = 'Добавить срок') {
  await deadlineForm(page).getByRole('button', { name: label, exact: true }).click();
  await expect(toast(page)).toContainText(
    label === 'Добавить срок' ? 'Срок добавлен' : 'Срок сохранён',
  );
  await expect(deadlineForm(page)).toHaveCount(0);
}

async function startAdd(page: Page) {
  await deadlinesSection(page).getByRole('button', { name: 'Добавить срок', exact: true }).click();
  await expect(deadlineForm(page)).toBeVisible();
}

test('срок в карточке объекта: каждый вид правила, подписи и предупреждения (DEAD-1)', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await signInAs(page, family, 'adult');
  await openObjectCard(page, object.id, 'Квартира у парка');

  await expect(deadlinesSection(page)).toContainText('Сроков пока нет.');
  await checkApp(page, info, 'deadlines-card-empty');

  // Дата с временем и предупреждением за 7 дней (оно отмечено по умолчанию).
  await startAdd(page);
  const form = deadlineForm(page);
  await expect(form.getByRole('radio', { name: 'Дата', exact: true })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'за 7 дней' })).toBeChecked();
  await form.getByRole('textbox', { name: 'Дата', exact: true }).fill(homeDate(10));
  await form.getByLabel('Время (необязательно)').fill('09:30');
  await checkApp(page, info, 'deadlines-form-date');
  await submitDeadline(page);
  await expect(items(page).getByRole('listitem')).toHaveCount(1);
  const first = items(page).getByRole('listitem').first();
  await expect(first).toContainText('Дата');
  expect(plain(await first.innerText())).toContain(', 9:30');
  await expect(first).toContainText('Ближайшее');
  await expect(first).toContainText('через 10 дней');
  await expect(first).toContainText('Предупреждение: за 7 дней');

  // Ошибка заполнения: без даты срок не сохраняется, поле названо и в фокусе.
  await startAdd(page);
  await form.getByRole('textbox', { name: 'Дата', exact: true }).fill('');
  await form.getByRole('button', { name: 'Добавить срок', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Укажите дату');
  await expect(form.getByRole('textbox', { name: 'Дата', exact: true })).toBeFocused();
  await checkApp(page, info, 'deadlines-form-error');

  // Окно «с — по» со временем начала и конца.
  await form.getByRole('radio', { name: 'Окно', exact: true }).check();
  await form.getByLabel('Начало, дата').fill(homeDate(20));
  await form.getByLabel('Начало, время').fill('09:00');
  await form.getByLabel('Конец, дата').fill(homeDate(22));
  await form.getByLabel('Конец, время').fill('18:00');
  await checkApp(page, info, 'deadlines-form-window');
  await submitDeadline(page);
  await expect(items(page).getByRole('listitem')).toHaveCount(2);
  const window = items(page).getByRole('listitem').filter({ hasText: 'Окно' });
  expect(plain(await window.innerText())).toMatch(/с \d+ \S+ 9:00 по \d+ \S+ 18:00/);

  // Окно не может закончиться раньше, чем началось.
  await startAdd(page);
  await form.getByRole('radio', { name: 'Окно', exact: true }).check();
  await form.getByLabel('Начало, дата').fill(homeDate(20));
  await form.getByLabel('Начало, время').fill('09:00');
  await form.getByLabel('Конец, дата').fill(homeDate(19));
  await form.getByLabel('Конец, время').fill('18:00');
  await form.getByRole('button', { name: 'Добавить срок', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Окно не может закончиться раньше');
  await form.getByRole('button', { name: 'Отмена' }).click();

  // Повтор ежемесячно: «каждый месяц 20–25 числа с 9:00».
  await startAdd(page);
  await form.getByRole('radio', { name: 'Повтор', exact: true }).check();
  await form.getByLabel('День месяца').fill('20');
  await form.getByLabel('Начиная с').fill(homeDate(-30));
  await form.getByLabel('Время начала (необязательно)').fill('09:00');
  await form.getByLabel('Длится ещё, дней').fill('5');
  await checkApp(page, info, 'deadlines-form-repeat');
  await submitDeadline(page);
  const monthly = items(page).getByRole('listitem').filter({ hasText: 'Повтор' });
  await expect(monthly).toContainText('каждый месяц 20–25 числа с 9:00');

  // Повтор ежегодно: «ежегодно 14 нояб.»; число дней предупреждения можно задать своё.
  await startAdd(page);
  await form.getByRole('radio', { name: 'Повтор', exact: true }).check();
  await form.getByRole('radio', { name: 'Годы', exact: true }).check();
  await form.getByLabel('Месяц', { exact: true }).selectOption('11');
  await form.getByLabel('День', { exact: true }).fill('14');
  await form.getByLabel('Другое число дней').fill('2');
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(form.getByRole('checkbox', { name: 'за 2 дня' })).toBeChecked();
  await form.getByLabel('Другое число дней').fill('999');
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('от 0 до 365');
  await form.getByLabel('Другое число дней').fill('');
  await checkApp(page, info, 'deadlines-form-year');
  await submitDeadline(page);
  const yearly = items(page).getByRole('listitem').filter({ hasText: 'ежегодно' });
  expect(plain(await yearly.innerText())).toContain('ежегодно 14 нояб.');
  await expect(yearly).toContainText('Предупреждение: за 7 и 2 дня');

  // Повтор каждые N дней.
  await startAdd(page);
  await form.getByRole('radio', { name: 'Повтор', exact: true }).check();
  await form.getByRole('radio', { name: 'Дни', exact: true }).check();
  await form.getByLabel('Каждые, дней').fill('10');
  await form.getByLabel('Начиная с').fill(homeDate(3));
  await submitDeadline(page);
  expect(plain(await items(page).innerText())).toContain('каждые 10 дней, начиная с');

  // «Через N после события»: без даты события срок ждёт её.
  await startAdd(page);
  await form.getByRole('radio', { name: 'После события', exact: true }).check();
  await expect(form.getByLabel('Дата события (необязательно)')).toHaveValue('');
  await form.getByLabel('Через сколько').fill('3');
  await form.getByRole('radio', { name: 'Месяцы', exact: true }).check();
  await checkApp(page, info, 'deadlines-form-after');
  await submitDeadline(page);
  const after = items(page).getByRole('listitem').filter({ hasText: 'После события' });
  await expect(after).toContainText('через 3 месяца после события (даты пока нет)');
  await expect(after).toContainText('Ждёт даты события');

  await checkApp(page, info, 'deadlines-card-list');

  const stored = await family.database.admin.query(
    "SELECT rule->>'kind' AS kind FROM deadlines ORDER BY created_at",
  );
  expect(stored.rows.map((row: { kind: string }) => row.kind)).toEqual([
    'date',
    'window',
    'repeat',
    'repeat',
    'repeat',
    'after',
  ]);
});

test('правка срока, немедленная корзина, отмена и восстановление из корзины', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const note = await seedNote(boris, family, { title: 'Страховка дачи', audience: 'household' });
  await seedDeadline(boris, 'notes', note.id, { kind: 'date', date: homeDate(5), warnings: [3] });
  await signInAs(page, family, 'adult');
  await openNoteCard(page, note.id, 'Страховка дачи');

  const item = items(page).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await item.getByRole('button', { name: /^Править:/ }).click();
  const form = deadlineForm(page);
  await expect(form.getByRole('textbox', { name: 'Дата', exact: true })).toHaveValue(homeDate(5));
  await expect(form.getByRole('checkbox', { name: 'за 3 дня' })).toBeChecked();
  await form.getByRole('textbox', { name: 'Дата', exact: true }).fill(homeDate(6));
  await form.getByLabel('Время (необязательно)').fill('18:00');
  await checkApp(page, info, 'deadlines-form-edit');
  await submitDeadline(page, 'Сохранить срок');
  expect(plain(await item.innerText())).toContain(', 18:00');
  await expect(item).toContainText('через 6 дней');

  // В корзину: сервер удаляет сразу; отмена вызывает restore.
  await item.getByRole('button', { name: /^В корзину:/ }).click();
  await expect(toast(page)).toContainText('Срок в корзине');
  await expect(toast(page)).toContainText('Восстановить можно также из «Корзины».');
  await expect(deadlinesSection(page)).toContainText('Сроков пока нет.');
  await checkApp(page, info, 'deadlines-trash-toast');
  const deletedAt = () =>
    family.database.admin
      .query('SELECT deleted_at FROM deadlines')
      .then((result) => (result.rows[0] as { deleted_at: Date | null }).deleted_at);
  expect(await deletedAt()).not.toBeNull();
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(item).toHaveCount(1);
  expect(await deletedAt()).toBeNull();

  // Потеря тоста не мешает восстановлению из «Корзины».
  await item.getByRole('button', { name: /^В корзину:/ }).click();
  await expect(deadlinesSection(page)).toContainText('Сроков пока нет.');
  await expect.poll(deletedAt, { timeout: 15_000 }).not.toBeNull();
  await page.reload();
  await expect(deadlinesSection(page)).toContainText('Сроков пока нет.');
  await page.goto('#/more/trash');
  const trash = page.getByRole('list', { name: 'Удалённые сроки' });
  await expect(trash).toContainText('Страховка дачи');
  await checkApp(page, info, 'deadlines-trash');
  await trash.getByRole('button', { name: 'Восстановить срок' }).click();
  await expect(trash).toHaveCount(0);
  await openNoteCard(page, note.id, 'Страховка дачи');
  await expect(item).toHaveCount(1);
});

test('радар: группы по времени дома, «Моё · Весь дом» и «Всё · Общее · Личное» (DEAD-3)', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  const insurance = await seedNote(boris, family, {
    title: 'Страховка дачи',
    audience: 'household',
  });
  const personal = await seedNote(boris, family, { title: 'Заметка о лекарствах' });
  const garage = await seedObject(boris, family, { title: 'Гараж', audience: 'household' });
  // За гараж отвечает Анна: в «Моём» Бориса его пункта нет.
  expect(
    (await boris.patch(`objects/${garage.id}`, { assigneeId: family.person('admin').id })).status,
  ).toBe(200);

  await seedDeadline(boris, 'objects', flat.id, { kind: 'date', date: homeDate(-3) });
  await seedDeadline(boris, 'objects', flat.id, {
    kind: 'window',
    date: homeDate(-1),
    time: '09:00',
    durationDays: 2,
    endTime: '18:00',
  });
  await seedDeadline(boris, 'notes', insurance.id, { kind: 'date', date: homeDate(5) });
  await seedDeadline(boris, 'notes', insurance.id, { kind: 'date', date: homeDate(20) });
  await seedDeadline(boris, 'notes', insurance.id, { kind: 'date', date: homeDate(60) });
  await seedDeadline(boris, 'notes', personal.id, { kind: 'date', date: homeDate(2) });
  await seedDeadline(boris, 'objects', garage.id, { kind: 'date', date: homeDate(4) });
  await recalc(family);

  await signInAs(page, family, 'adult');

  // «Ещё» → «Радар».
  await page.goto('#/more');
  await page.getByRole('link', { name: /^Радар/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Радар', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем радар…')).toHaveCount(0);

  // «Моё»: шесть пунктов, пять групп; гаража Анны нет.
  await expect(page.getByRole('radio', { name: 'Моё', exact: true })).toBeChecked();
  expect(await radarSummary(page)).toEqual({
    Просрочено: 1,
    Сейчас: 1,
    '7 дней': 2,
    '30 дней': 1,
    '90 дней': 1,
  });
  await expect(page.getByText('6 пунктов', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Просрочено', exact: true }),
  ).toBeVisible();
  await expect(groupItems(page, 'Просрочено')).toContainText('Квартира у парка');
  await expect(groupItems(page, 'Просрочено')).toContainText('просрочено на 3 дня');
  await expect(groupItems(page, 'Сейчас')).toContainText('Квартира у парка');
  await expect(groupItems(page, 'Сейчас')).toContainText('идёт до');
  await expect(groupItems(page, '7 дней').filter({ hasText: 'Гараж' })).toHaveCount(0);
  await expect(groupItems(page, '7 дней').filter({ hasText: 'Страховка дачи' })).toContainText(
    'через 5 дней',
  );
  await expect(groupItems(page, '30 дней')).toContainText('через 20 дней');
  await expect(groupItems(page, '90 дней')).toContainText('Дата');
  // Значки пространства: замок у личной заметки, «Взрослые» у квартиры.
  await expect(
    groupItems(page, '7 дней').filter({ hasText: 'Заметка о лекарствах' }).getByRole('img', {
      name: 'Кто видит: Только я',
    }),
  ).toBeVisible();
  await expect(
    groupItems(page, 'Просрочено').getByRole('img', { name: 'Кто видит: Взрослые' }),
  ).toBeVisible();
  await checkApp(page, info, 'radar-groups');

  // «Весь дом»: добавляется гараж Анны.
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(groupItems(page, '7 дней')).toHaveCount(3);
  await expect(page.getByText('7 пунктов', { exact: true })).toBeVisible();
  await expect(groupItems(page, '7 дней').filter({ hasText: 'Гараж' })).toContainText(
    'через 4 дня',
  );
  await checkApp(page, info, 'radar-house');

  // «Всё · Общее · Личное».
  await setScope(page, 'Личное');
  expect(await radarSummary(page)).toEqual({ '7 дней': 1 });
  await expect(groupItems(page, '7 дней')).toContainText('Заметка о лекарствах');
  await checkApp(page, info, 'radar-personal');
  await setScope(page, 'Общее');
  await expect(groupItems(page, '7 дней').filter({ hasText: 'Заметка о лекарствах' })).toHaveCount(
    0,
  );
  await expect(page.getByText('6 пунктов', { exact: true })).toBeVisible();
  await setScope(page, 'Всё');

  // Переход в карточку записи.
  await groupItems(page, 'Просрочено').getByRole('link').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  await expect(items(page).getByRole('listitem')).toHaveCount(2);

  // «Сегодня»: срочное из радара — только просроченное и открытое, и только своё.
  await page.goto('#/today');
  const urgent = page.getByRole('list', { name: 'Срочные сроки' });
  await expect(urgent.getByRole('listitem')).toHaveCount(2);
  await expect(urgent).toContainText('Квартира у парка');
  await expect(urgent).not.toContainText('Страховка дачи');
  await checkApp(page, info, 'today-radar');
});

test('радар: пустые состояния (TPL-4) — нет сроков, «Моё» пусто, режим без сроков', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  const empty = page.getByRole('region', { name: 'Сроков пока нет' });
  await expect(empty).toContainText('нажмите «Добавить срок»');
  await expect(page.getByText('Срочного нет')).toHaveCount(0);
  await checkApp(page, info, 'radar-empty');

  const boris = await apiAs(family, 'adult');
  const garage = await seedObject(boris, family, { title: 'Гараж', audience: 'household' });
  await boris.patch(`objects/${garage.id}`, { assigneeId: family.person('admin').id });
  await seedDeadline(boris, 'objects', garage.id, { kind: 'date', date: homeDate(4) });
  await recalc(family);

  // Срок есть, но за него отвечает Анна: в «Моём» пусто, кнопка ведёт в «Весь дом».
  await openRadar(page);
  const mine = page.getByRole('region', { name: 'У вас сроков нет' });
  await expect(mine).toContainText('«Моё» показывает только то, за что отвечаете вы');
  await checkApp(page, info, 'radar-empty-mine');
  await setScope(page, 'Личное');
  await expect(page.getByRole('region', { name: 'У вас сроков нет' })).toContainText(
    'Здесь только ваши записи',
  );
  await page.getByRole('button', { name: 'Показать «Всё»' }).click();
  await mine.getByRole('button', { name: 'Показать «Весь дом»' }).click();
  await expect(groupItems(page, '7 дней')).toContainText('Гараж');

  // «Сегодня»: срочного нет, но это не пустой экран.
  await page.goto('#/today');
  await expect(page.getByText('Срочного нет', { exact: false })).toBeVisible();
});

test('срок скрыт вместе с записью: ребёнок не видит «Взрослых», личное не видит второй взрослый', async ({
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const rules = await seedObject(boris, family, { title: 'Правила дома', audience: 'household' });
  const bills = await seedObject(boris, family, { title: 'Счета на квартиру', audience: 'adults' });
  const secret = await seedNote(boris, family, { title: 'Подарок на юбилей' });
  await seedDeadline(boris, 'objects', rules.id, { kind: 'date', date: homeDate(5) });
  await recalc(family);

  const vera = await apiAs(family, 'child');
  const window = `from=2000-01-01&to=${homeDate(95)}`;
  const before = (await vera.get(`deadlines?${window}`)).body as {
    groups: Record<string, number>;
    items: unknown[];
  };
  expect(before.items).toHaveLength(1);

  // Срок «Взрослых» и личный срок Бориса: Вера не видит, число пунктов в её группах прежнее.
  await seedDeadline(boris, 'objects', bills.id, { kind: 'date', date: homeDate(-2) });
  await seedDeadline(boris, 'objects', bills.id, { kind: 'date', date: homeDate(6) });
  await seedDeadline(boris, 'notes', secret.id, { kind: 'date', date: homeDate(3) });
  await recalc(family);
  const after = (await vera.get(`deadlines?${window}`)).body as typeof before;
  expect(after.groups).toEqual(before.groups);
  expect(after.items).toHaveLength(1);
  expect((await vera.get(`objects/${bills.id}/deadlines`)).status).toBe(404);
  expect((await vera.get(`notes/${secret.id}/deadlines`)).status).toBe(404);

  const child = await openAs(browser, family, info, 'child');
  try {
    await openRadar(child.page);
    await child.page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
    expect(await radarSummary(child.page)).toEqual({ '7 дней': 1 });
    await expect(child.page.getByText('1 пункт', { exact: true })).toBeVisible();
    const text = await child.page.locator('main').innerText();
    for (const hidden of ['Счета на квартиру', 'Подарок на юбилей', 'Просрочено'])
      expect(text, `«${hidden}» в радаре ребёнка`).not.toContain(hidden);
    await checkApp(child.page, info, 'radar-child');
    // Карточка скрытой записи и её сроков ребёнку недоступна.
    const status = await child.page.evaluate(
      async (id) => (await fetch(`/api/objects/${id}/deadlines`)).status,
      bills.id,
    );
    expect(status).toBe(404);
  } finally {
    await child.close();
  }

  // Анна — второй взрослый: «Взрослые» видит, личное Бориса — нет.
  const anna = await openAs(browser, family, info, 'admin');
  try {
    await openRadar(anna.page);
    await anna.page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
    await expect(anna.page.getByText('Счета на квартиру').first()).toBeVisible();
    await expect(anna.page.getByText('Правила дома').first()).toBeVisible();
    await expect(anna.page.getByText('Подарок на юбилей')).toHaveCount(0);
    expect(await radarSummary(anna.page)).toEqual({ Просрочено: 1, '7 дней': 2 });
    await setScope(anna.page, 'Личное');
    await expect(
      anna.page.getByRole('region', { name: 'Под выбранный режим сроков нет' }),
    ).toBeVisible();
    const status = await anna.page.evaluate(
      async (id) => (await fetch(`/api/notes/${id}/deadlines`)).status,
      secret.id,
    );
    expect(status).toBe(404);
    // Сессия может смениться в другой вкладке, а QueryClient текущей вкладки остаётся.
    // Даже свежий кэш взрослого не должен появиться у ребёнка после перечитывания /me.
    const next = await openAs(browser, family, info, 'child');
    try {
      await setScope(anna.page, 'Всё');
      await anna.page.context().clearCookies();
      await anna.page.context().addCookies(await next.page.context().cookies());
      await anna.page.bringToFront();
      const changed = anna.page.waitForResponse((response) => response.url().endsWith('/api/me'));
      await anna.page.evaluate(() => globalThis.dispatchEvent(new Event('visibilitychange')));
      expect((await (await changed).json()).roles[0].role).toBe('child');
      await expect(anna.page.getByText('Счета на квартиру')).toHaveCount(0);
      await expect(anna.page.getByText('Правила дома')).toBeVisible();
      expect(await radarSummary(anna.page)).toEqual({ '7 дней': 1 });
    } finally {
      await next.close();
    }
  } finally {
    await anna.close();
  }

  // Ребёнок не может менять сроки даже видимой записи: блок без кнопок.
  const kid = await openAs(browser, family, info, 'child');
  try {
    await openObjectCard(kid.page, rules.id, 'Правила дома');
    await expect(deadlinesSection(kid.page)).toContainText('могут менять только взрослые');
    await expect(
      deadlinesSection(kid.page).getByRole('button', { name: 'Добавить срок' }),
    ).toHaveCount(0);
    await expect(deadlinesSection(kid.page).getByRole('button', { name: /^Править:/ })).toHaveCount(
      0,
    );
    await checkApp(kid.page, info, 'deadlines-card-child');
  } finally {
    await kid.close();
  }
});

test('часовой пояс дома: администратор меняет, остальные видят; даты идут по нему (DEAD-6)', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, {
    title: 'Квартира у парка',
    audience: 'household',
  });
  await seedDeadline(boris, 'objects', object.id, {
    kind: 'date',
    date: homeDate(5),
    time: '09:00',
  });
  await recalc(family);
  const startsAt = async () =>
    (await family.database.admin.query('SELECT starts_at, time_zone FROM deadline_occurrences'))
      .rows as { starts_at: Date; time_zone: string }[];
  const [moscow] = await startsAt();
  expect(moscow?.time_zone).toBe('Europe/Moscow');

  // Взрослый видит пояс, но не меняет его.
  const adult = await openAs(browser, family, info, 'adult');
  try {
    await adult.page.goto('#/more/house');
    await expect(
      adult.page.getByRole('heading', { level: 1, name: 'Настройки дома' }),
    ).toBeVisible();
    await expect(adult.page.getByText('Москва (UTC+3)')).toBeVisible();
    await expect(
      adult.page.getByText('Менять часовой пояс дома может только администратор.'),
    ).toBeVisible();
    await expect(adult.page.getByLabel('Новый часовой пояс')).toHaveCount(0);
    await checkApp(adult.page, info, 'house-adult');
  } finally {
    await adult.close();
  }

  // Администратор: «Ещё» → «Настройки дома» → Екатеринбург.
  await signInAs(page, family, 'admin');
  await openObjectCard(page, object.id, 'Квартира у парка');
  const edited = page.locator('.page-heading__eyebrow');
  const stamp = async () => plain(await edited.innerText());
  const beforeStamp = await stamp();
  await page.goto('#/more');
  await page.getByRole('link', { name: /^Настройки дома/ }).click();
  await expect(page.getByText('Москва (UTC+3)').first()).toBeVisible();
  const zone = page.getByLabel('Новый часовой пояс');
  await expect(page.getByRole('button', { name: 'Сохранить часовой пояс' })).toBeDisabled();
  await checkApp(page, info, 'house-admin');
  await zone.selectOption('Asia/Yekaterinburg');
  await page.getByRole('button', { name: 'Сохранить часовой пояс' }).click();
  await expect(toast(page)).toContainText('Часовой пояс дома изменён');
  await expect(
    page.getByRole('definition').filter({ hasText: 'Екатеринбург (UTC+5)' }),
  ).toBeVisible();
  const stored = await family.database.admin.query(
    "SELECT time_zone FROM spaces WHERE kind = 'household'",
  );
  expect(stored.rows).toEqual([{ time_zone: 'Asia/Yekaterinburg' }]);

  // Все даты на экранах пошли по новому поясу: время изменения сдвинулось на два часа.
  await openObjectCard(page, object.id, 'Квартира у парка');
  const afterStamp = await stamp();
  expect(afterStamp).not.toBe(beforeStamp);
  const hour = (text: string) => Number(/, (\d{2}):\d{2}$/.exec(text)?.[1]);
  expect((hour(afterStamp) - hour(beforeStamp) + 24) % 24).toBe(2);

  // До пересчёта прежние моменты показаны с явным признаком пересчёта.
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(page.getByText('Идёт пересчёт', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Сроков пока нет' })).toHaveCount(0);
  await checkApp(page, info, 'radar-recalculating');
  await recalc(family);
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(groupItems(page, '7 дней')).toContainText('Квартира у парка');
  expect(plain(await groupItems(page, '7 дней').innerText())).toContain(', 9:00');
  const [yekaterinburg] = await startsAt();
  expect(yekaterinburg?.time_zone).toBe('Asia/Yekaterinburg');
  expect(moscow && yekaterinburg && +moscow.starts_at - +yekaterinburg.starts_at).toBe(
    2 * 3_600_000,
  );
  await checkApp(page, info, 'radar-zone-changed');
});

test('названия записей и сроков не попадают в адреса, хранилища, кэш и консоль', async ({
  page,
  family,
}) => {
  await setHomeZone(family);
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  const note = await seedNote(boris, family, { title: 'Страховка дачи' });
  await seedDeadline(boris, 'objects', object.id, { kind: 'date', date: homeDate(-1) });
  await seedDeadline(boris, 'notes', note.id, { kind: 'date', date: homeDate(2) });
  await recalc(family);

  await signInAs(page, family, 'adult');
  await openObjectCard(page, object.id, 'Квартира у парка');
  await openNoteCard(page, note.id, 'Страховка дачи');
  await openRadar(page);
  await expect(page.getByText('Страховка дачи').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await page.goto('#/today');
  await expect(page.getByRole('heading', { level: 2, name: 'Срочное из радара' })).toBeVisible();
  await expectNothingStored(page, ['Квартира у парка', 'Страховка дачи']);
  expect(messages.join('\n')).not.toMatch(/Квартира у парка|Страховка дачи/);
});
