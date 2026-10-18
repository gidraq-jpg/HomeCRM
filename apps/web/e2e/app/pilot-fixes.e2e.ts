import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { apiAs, seedNote, seedObject } from './notes-support.ts';
import { seedOrganization, seedPerson } from './people-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  await expectAccessible(page, `D19-${name}-${info.project.name}`);
  await expectTouchTargets(page);
  if (process.platform === 'linux') {
    const directory = resolve(
      import.meta.dirname,
      process.env.D19_CAPTURE === '1'
        ? '../../../../docs/screenshots/D19'
        : '../../test-results/screens/D19',
    );
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `${name}-${info.project.name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: 'image/png' });
  }
}

test('D19a.1–3/13: повтор возвращается отменой без лишнего экземпляра, подпись и фокус тоста', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const response = await api.post('tasks', {
    title: 'Протереть стол D19',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
  });
  expect(response.status).toBe(201);
  const id = (response.body as { id: string }).id;
  const second = await api.post('tasks', {
    title: 'Возврат после обновления D19',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
  });
  expect(second.status).toBe(201);
  const secondId = (second.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await page
    .getByRole('button', { name: 'Отметить сделанным: Протереть стол D19', exact: true })
    .click();
  const row = page.locator('.plan-row').filter({ hasText: 'Протереть стол D19' }).first();
  await expect(row).toHaveClass(/plan-row--closed/);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  const completed = (await api.get(`tasks/${id}`)).body as { nextTaskId: string };
  expect(completed.nextTaskId).toBeTruthy();
  const muted = await row.evaluate((element) => {
    const hex = getComputedStyle(element).getPropertyValue('--muted').trim();
    return `rgb(${[1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
  });
  await expect(row.locator('.plan-row__title')).toHaveCSS('color', muted);
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  await undo.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(undo).toBeFocused();
  await expect(undo).toHaveCSS('outline-style', 'solid');
  const focusContrast = await undo.evaluate((element) => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return (
        (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
      );
    };
    const ring = luminance(getComputedStyle(element).outlineColor);
    const toast = element.closest('.toast');
    if (!toast) throw new Error('Test toast is missing');
    const background = luminance(getComputedStyle(toast).backgroundColor);
    return (Math.max(ring, background) + 0.05) / (Math.min(ring, background) + 0.05);
  });
  expect(focusContrast).toBeGreaterThanOrEqual(3);
  await check(page, info, 'all-completed');
  await page
    .getByRole('button', { name: 'Возобновить: Протереть стол D19', exact: true })
    .first()
    .click();
  await expect(page.getByText('Выполнение отменено', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await api.get(`tasks/${id}`)).body)
    .toMatchObject({ status: 'open' });
  expect((await api.get(`tasks/${completed.nextTaskId}`)).body).toMatchObject({
    deletedAt: expect.any(String),
  });
  await page
    .getByRole('button', { name: 'Отметить сделанным: Возврат после обновления D19', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  const secondCompleted = (await api.get(`tasks/${secondId}`)).body as { nextTaskId: string };
  await page.reload();
  await page
    .getByRole('button', { name: 'Возобновить: Возврат после обновления D19', exact: true })
    .click();
  await expect(page.getByText('Выполнение отменено', { exact: true })).toBeVisible();
  expect((await api.get(`tasks/${secondCompleted.nextTaskId}`)).body).toMatchObject({
    deletedAt: expect.any(String),
  });
});

test('D19a.2: выполненное без сети старое дело остаётся в своём дне до и после синхронизации', async ({
  page,
  context,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const response = await api.post('tasks', { title: 'Старое дело D19', planOn: homeDate(-4) });
  const id = (response.body as { id: string }).id;
  await family.database.admin.query('ALTER TABLE tasks DISABLE TRIGGER USER');
  try {
    await family.database.admin.query(
      "UPDATE tasks SET updated_at=now()-interval '4 days' WHERE id=$1",
      [id],
    );
  } finally {
    await family.database.admin.query('ALTER TABLE tasks ENABLE TRIGGER USER');
  }
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: 'Старое дело D19', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Отметить сделанным: Старое дело D19', exact: true })
    .click();
  const completed = page
    .getByRole('list', { name: 'Просрочено', exact: true })
    .getByRole('link', { name: 'Старое дело D19 · выполнено', exact: true });
  await expect(completed).toBeVisible();
  await check(page, info, 'all-offline');
  await context.setOffline(false);
  await expect
    .poll(async () => (await api.get(`tasks/${id}`)).body)
    .toMatchObject({ status: 'done' });
  await expect(completed).toBeVisible();
  await page.reload();
  await expect(completed).toBeVisible();
});

test('D19a.3–5: План без observer, Tab подгружает дни, перенос запрещает прошлое, GET после PATCH не отменяет успех', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family, 'Pacific/Kiritimati');
  const zone = 'Pacific/Kiritimati';
  const api = await apiAs(family, 'adult');
  const current = await api.post('tasks', { title: 'Перенос D19', planOn: homeDate(0, zone) });
  const id = (current.body as { id: string }).id;
  for (const fields of [
    { title: 'Прошёл план D19', planOn: homeDate(-1, zone) },
    { title: 'Прошёл срок D19', planOn: homeDate(1, zone), dueOn: homeDate(-1, zone) },
    { title: 'Далёкое дело D19', planOn: homeDate(18, zone) },
  ])
    expect((await api.post('tasks', fields)).status).toBe(201);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined });
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/today/plan');
  await expect(page.getByRole('link', { name: /1 просроченное дело/ })).toBeVisible();
  await expect(page.locator('.studio-label--overdue')).toHaveCount(1);
  const load = page.getByRole('button', { name: 'Показать следующие дни' });
  await load.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Далёкое дело D19', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Перенести: Перенос D19', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать дату…', exact: true }).click();
  const date = page.getByLabel('Дата переноса', { exact: true });
  await expect(date).toHaveAttribute('min', homeDate(0, zone));
  await date.fill(homeDate(-1, zone));
  await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toBeDisabled();
  await date.fill(homeDate(2, zone));
  await page.route(`**/api/tasks/${id}?*`, (route) => route.abort('failed'));
  await page.route(`**/api/tasks/${id}`, (route) =>
    route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
  );
  await page.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByText(/^Перенесено на/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await check(page, info, 'plan');
  // Проверка очистки по строгой схеме: повторный перенос использует версию, не служебные поля.
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({ planOn: homeDate(2, zone) });
});

test('D19a.6/9/10/13: покупки без Map.groupBy, назад из правки, dock по переходу, замок и отсутствие ручки', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const object = await seedObject(api, family, { title: 'Вымышленный объект D19' });
  await page.addInitScript(() => {
    Object.defineProperty(Map, 'groupBy', { value: undefined });
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  await expect(page.getByRole('heading', { name: 'Покупки', exact: true })).toBeVisible();
  await page.getByLabel('Добавить одной строкой', { exact: true }).fill('Мыло D19');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Мыло D19', { exact: true })).toBeVisible();
  await check(page, info, 'shopping');
  expect(
    await page
      .locator('.studio-list-panel')
      .evaluate((element) => getComputedStyle(element, '::before').content),
  ).toBe('none');
  await page.getByRole('button', { name: 'Пространство: Всё', exact: true }).click();
  await expect(
    page.locator('.scope-switch__option').filter({ hasText: 'Личное' }).locator('svg'),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Пространство: Всё', exact: true })).toBeFocused();
  await page.goto(`#/home/${object.id}/files`);
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await expect(page.locator('.ui7-fullscreen-form')).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
  await check(page, info, 'object');
  await page.goto('#/more/radar?view=mine');
  await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveText('Ещё');
  await page.goto('#/today');
  await page.locator('.today-hero a[href*="/more/radar"]').click();
  await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveText('Сегодня');
  await check(page, info, 'radar');
});

test('D19a.11: ошибка копии в листе; фокус возвращается после вложенного листа и доступа дела', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Заметка D19', audience: 'household' });
  const task = (await api.post('tasks', { title: 'Дело доступа D19' })).body as { id: string };
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/notes/${note.id}`);
  const trigger = page.getByRole('button', { name: 'Кто видит запись', exact: true });
  await trigger.click();
  await page.route(`**/api/notes/${note.id}/copy*`, (route) =>
    route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } }),
  );
  await page.getByRole('button', { name: 'Скопировать в личное', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.auth-notice--error')).toBeVisible();
  await check(page, info, 'note-error');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Кто видит…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Кто видит заметку', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.goto(`#/today/tasks/${task.id}`);
  const taskAccess = page.getByRole('button', { name: 'Кто видит запись', exact: true });
  await taskAccess.click();
  await page.keyboard.press('Escape');
  await expect(taskAccess).toBeFocused();
});

test('D19a.11–12: ребёнку метка заметки без кнопки, уровни заголовков месяца и напоминание человека', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const childApi = await apiAs(family, 'child');
  const note = await seedNote(childApi, family, { title: 'Личная заметка ребёнка D19' });
  const object = await seedObject(api, family, {
    title: 'Вымышленная квартира D19',
    objectType: 'property',
  });
  const person = await seedPerson(api, {
    title: 'Вымышленный человек D19',
    data: { birthday: '1985-03-14', birthdayEnabled: true },
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/home/month');
  await expect(
    page.getByRole('heading', { level: 3, name: object.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 4, name: 'Лицевые счета', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Лицевых счетов нет.', { exact: true })).toBeVisible();
  await check(page, info, 'month');
  await page.goto(`#/people/contacts/${person.id}`);
  await expect(page.locator('dt').filter({ hasText: /^День рождения$/ })).toHaveCount(1);
  await expect(
    page.locator('.object-facts > div').filter({ hasText: 'День рождения' }),
  ).toContainText('Напоминание включено');
  await expect(
    page.locator('.ui6-record-panel dt').filter({ hasText: 'День рождения' }),
  ).toHaveCount(0);
  await check(page, info, 'person');
  await page.context().clearCookies();
  await signInAs(page, family, 'child');
  await page.goto(`#/more/notes/${note.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: note.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Кто видит запись', exact: true })).toHaveCount(0);
  await check(page, info, 'note-child');
});

test('D19a.14: плюс открывает форму раздела из списка и карточки, шаблон — ссылкой', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const object = await seedObject(api, family, { title: 'Объект плюса D19' });
  const note = await seedNote(api, family, { title: 'Заметка плюса D19' });
  const document = await seedDocument(api, { title: 'Документ плюса D19', type: 'other' });
  const person = await seedPerson(api, { title: 'Человек плюса D19' });
  const organization = await seedOrganization(api, { title: 'Организация плюса D19' });
  await signInAs(page, family, 'adult');
  for (const [list, card, label, target, heading] of [
    ['/home', `/home/${object.id}`, 'Добавить объект', '/home/new', 'Новый объект'],
    [
      '/documents',
      `/documents/${document.id}`,
      'Добавить документ',
      '/documents/new',
      'Новый документ',
    ],
    [
      '/people',
      `/people/contacts/${person.id}`,
      'Добавить человека',
      '/people/contacts/new',
      'Новый человек',
    ],
    [
      '/more/notes',
      `/more/notes/${note.id}`,
      'Добавить заметку',
      '/more/notes/new',
      'Новая заметка',
    ],
    [
      '/more/organizations',
      `/more/organizations/${organization.id}`,
      'Добавить организацию',
      '/more/organizations/new',
      'Новая организация',
    ],
  ]) {
    for (const source of [list, card]) {
      await page.goto(`#${source}`);
      await page.locator(`button.studio-add[aria-label="${label}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${target}$`));
      await expect(
        page.getByRole('heading', { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.locator('.ui7-fullscreen-form .studio-add')).toHaveCount(0);
      if (target === '/home/new')
        await expect(
          page.getByRole('link', { name: 'Заполнить из шаблона', exact: true }),
        ).toHaveAttribute('href', '#/home/from-template');
    }
  }
  await check(page, info, 'section-add-form');
});

test('D19a.14: Сегодня показывает меню, План/Все дела/служебный экран — быстрое дело, покупки — фокус', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/today');
  await page.locator('button.studio-add').click();
  await expect(page.getByRole('dialog', { name: 'Добавить', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const path of ['/today/plan', '/today/all', '/more', '/more/profile', '/home/month']) {
    await page.goto(`#${path}`);
    await page.locator('button.studio-add[aria-label="Добавить дело"]').click();
    await expect(page.getByRole('dialog', { name: 'Новое дело', exact: true })).toBeVisible();
    await check(page, info, `quick-${path.split('/').at(-1)}`);
    await page.keyboard.press('Escape');
  }
  await page.goto('#/more/shopping');
  await page.getByRole('button', { name: 'Добавить покупку', exact: true }).click();
  await expect(page.getByLabel('Добавить одной строкой', { exact: true })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
