import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAuthDatabase } from '@homecrm/db';
import { localDate, shiftTaskDate } from '@homecrm/shared';
import type { Page, TestInfo } from '@playwright/test';
import { createHousehold, provisionAccount } from '../../../server/src/auth/provision.ts';
import type { Family } from '../auth/support/family.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { seedDeadline } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { makePng } from './files-support.ts';
import { apiAs, apiAsUser } from './notes-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  if (await page.getByRole('dialog').count())
    await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await expectAccessible(page, name);
  await expectTouchTargets(page);
  await expectNoHorizontalScroll(page);
  if (process.platform === 'linux') {
    const directory = resolve(
      import.meta.dirname,
      '../../../../docs/screenshots/R1c.4c',
      info.project.name,
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
  }
}
async function refocus(page: Page) {
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/me',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await response;
}
async function switchToChild(page: Page, family: Family) {
  const other = await page.context().newPage();
  await other.goto(family.baseURL);
  const person = family.person('child');
  expect(
    await other.evaluate(
      async (person) =>
        (
          await fetch('/api/auth/sign-in/username', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: person.username, password: person.password }),
          })
        ).status,
      person,
    ),
  ).toBe(200);
  await page.bringToFront();
  await refocus(page);
  await other.close();
}

test('B1: A → B в соседней вкладке сбрасывает личную форму без logout; refetch A сохраняет её', async ({
  page,
  family,
}) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/today/new');
  await page.getByLabel('Название дела').fill('Личный черновик A');
  const same = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await same;
  await expect(page.getByLabel('Название дела')).toHaveValue('Личный черновик A');
  const other = await page.context().newPage();
  await other.goto(family.baseURL);
  const person = family.person('child');
  expect(
    await other.evaluate(async (person) => {
      const response = await fetch('/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: person.username, password: person.password }),
      });
      return response.status;
    }, person),
  ).toBe(200);
  const changed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/me',
  );
  await page.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await changed;
  await expect(page.getByLabel('Название дела')).toHaveValue('');
  await expect(page.getByText('Личный черновик A', { exact: false })).toHaveCount(0);
  await other.close();
});

for (const view of ['all', 'card'] as const) {
  test(`B2: ${view} — отмена во время задержанного refetch отправляет один undo`, async ({
    page,
    family,
  }) => {
    const api = await apiAs(family, 'adult');
    const created = await api.post('tasks', {
      title: 'Серия с медленным refetch',
      planOn: '2030-01-01',
      repeatRule: { kind: 'daily' },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    await signInAs(page, family, 'adult');
    await page.goto(view === 'all' ? '#/today/all' : `#/today/tasks/${id}`);
    await expect(page.getByRole('button', { name: 'Выполнить', exact: true })).toBeVisible();
    let completed = false;
    let undoRequests = 0;
    let refetchStarted = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    page.on('response', (response) => {
      if (response.url().endsWith(`tasks/${id}/status`) && response.status() === 200)
        completed = true;
    });
    page.on('request', (request) => {
      if (request.url().endsWith(`tasks/${id}/undo`)) undoRequests++;
    });
    await page.route('**/api/tasks**', async (route) => {
      if (route.request().method() === 'GET' && completed && !undoRequests) {
        const response = await route.fetch();
        refetchStarted = true;
        await gate;
        await route.fulfill({ response });
      } else await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
      await expect.poll(() => refetchStarted).toBe(true);
      const undo = page.getByRole('button', {
        name: view === 'all' ? 'Отменить' : /Отменить выполнение/,
        exact: view === 'all',
      });
      await undo.click({ timeout: 2000 });
      await expect.poll(() => undoRequests, { timeout: 2000 }).toBe(1);
      release();
      await expect
        .poll(async () => (await api.get(`tasks/${id}`)).body)
        .toMatchObject({ status: 'open', nextTaskId: null });
      await expect(page.getByRole('button', { name: 'Выполнить', exact: true })).toBeEnabled();
      expect(undoRequests).toBe(1);
    } finally {
      release();
    }
  });
}

test('B1: быстрая строка, чипы и задержанный ответ A не открывают запись и тост в B', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.getByLabel('Быстрая строка').fill('Личный текст A завтра в 10:00');
  await refocus(page);
  await expect(page.getByLabel('Быстрая строка')).toHaveValue('Личный текст A завтра в 10:00');
  await page.getByRole('button', { name: /Дата:/ }).click();
  await check(page, info, 'b1-quickline-chip');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let oldFinished = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      const response = await route.fetch();
      oldFinished = true;
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Добавить дело', exact: true }).click();
    await expect.poll(() => oldFinished).toBe(true);
    await switchToChild(page, family);
    await expect(page.getByLabel('Быстрая строка')).toHaveValue('');
    const late = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/tasks',
    );
    release();
    await late;
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.getByText('Личный текст A', { exact: false })).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
  } finally {
    release();
  }
});

for (const surface of ['confirmation', 'undo'] as const) {
  test(`B1: A → B сбрасывает ${surface} и сохранённое действие`, async ({ page, family }) => {
    const api = await apiAs(family, 'adult');
    const created = await api.post('tasks', {
      title: 'Личное дело A',
      planOn: localDate(new Date(), 'UTC'),
    });
    const id = (created.body as { id: string }).id;
    await signInAs(page, family, 'adult');
    if (surface === 'confirmation') {
      await page.goto(`#/today/tasks/${id}`);
      await page.getByRole('button', { name: 'Передать…', exact: true }).click();
      await page.getByLabel('Исполнитель', { exact: true }).selectOption(family.person('child').id);
      await page.getByRole('button', { name: 'Передать выбранному', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Подтвердите доступ' })).toBeVisible();
    } else {
      await page.goto('#/today/all');
      await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
    }
    await switchToChild(page, family);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.getByText('Личное дело A', { exact: false })).toHaveCount(0);
  });
}

test('B3/A4: имена теряющих доступ, отказ, перенос, чужой чек-лист и файл запрещают личное', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const placement = { spaceId: family.houseId, audience: 'household' };
  const created = await api.post('tasks', {
    title: 'Общее дело без вклада',
    placement,
    checklist: [{ id: randomUUID(), title: 'Пункт', done: false, position: 0 }],
  });
  const id = (created.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${id}`);
  await page.getByRole('button', { name: 'Размещение и аудитория…' }).click();
  await page.getByRole('radio', { name: 'Взрослые', exact: true }).check();
  await expect(page.getByText(/Потеряют доступ:/)).toContainText('Вера');
  await check(page, info, 'b3-narrowing');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({ audience: 'household' });
  await page.getByRole('button', { name: 'Сделать личной', exact: true }).click();
  await expect(page.getByText(/Потеряют доступ:/)).toContainText('Анна');
  await expect(page.getByText(/Потеряют доступ:/)).toContainText('Вера');
  await check(page, info, 'a4-personal-confirm');
  await page.getByRole('button', { name: 'Подтвердить перенос' }).click();
  await expect
    .poll(async () => (await api.get(`tasks/${id}`)).body)
    .toMatchObject({ spaceKind: 'personal' });
  const child = await apiAs(family, 'child');
  expect((await child.get(`tasks/${id}`)).status).toBe(404);
  await api.post(`tasks/${id}/move`, {
    ...placement,
    assigneeId: family.person('child').id,
    confirmed: true,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Размещение и аудитория…' }).click();
  await expect(page.getByRole('radio', { name: 'Взрослые', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const row = (await api.get(`tasks/${id}`)).body as { checklist: Record<string, unknown>[] };
  expect(
    (
      await child.patch(`tasks/${id}`, {
        checklist: row.checklist.map((item) => ({ ...item, done: true })),
      })
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Общее дело без вклада', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сделать личной' })).toHaveCount(0);
  expect(
    (
      await api.post(`tasks/${id}/move`, {
        spaceId: family.person('adult').personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(403);
  const fileTask = await api.post('tasks', {
    title: 'Дело с чужим вложением',
    placement,
    assigneeId: family.person('child').id,
  });
  const fileId = (fileTask.body as { id: string }).id;
  expect(
    (
      await child.upload(`tasks/${fileId}/files`, {
        name: 'Вклад.png',
        type: 'image/png',
        data: makePng(16, 16),
      })
    ).status,
  ).toBe(201);
  expect((await api.get(`tasks/${fileId}`)).body).toMatchObject({ hasOtherContributions: true });
  await page.goto(`#/today/tasks/${fileId}`);
  await expect(
    page.getByRole('heading', { name: 'Дело с чужим вложением', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сделать личной' })).toHaveCount(0);
  const preview = page.locator('.file-row__image');
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((image) => (image as HTMLImageElement).complete))
    .toBe(true);
});

test('B4: объект, документ и ручной срок H2 используют участников H2 и подтверждённое значение', async ({
  page,
  family,
}, info) => {
  const db = createAuthDatabase(family.database.admin);
  const second = await createHousehold(db, 'Второй дом');
  await family.database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
    [second, family.person('adult').id],
  );
  const password = randomBytes(18).toString('base64url');
  const member = await provisionAccount(db, {
    username: 'second',
    displayName: 'Участник второго дома',
    password,
    householdId: second,
    role: 'adult',
  });
  const api = await apiAs(family, 'adult');
  const object = (
    await api.post('objects', {
      title: 'Объект H2',
      placement: { spaceId: second, audience: 'adults' },
    })
  ).body as { id: string };
  const doc = await seedDocument(api, {
    title: 'Документ H2',
    indefinite: true,
    placement: { spaceId: second, audience: 'adults' },
  });
  const deadline = await seedDeadline(api, 'objects', object.id, {
    kind: 'date',
    date: '2030-01-02',
  });
  await signInAs(page, family, 'adult');
  for (const [path, endpoint] of [
    [`/home/${object.id}`, `objects/${object.id}`],
    [`/documents/${doc.id}`, `documents/${doc.id}`],
  ]) {
    await page.goto(`#${path}`);
    const field = page.locator('.task-responsible').first();
    await expect(field.getByLabel('Ответственный')).toBeVisible();
    await expect(field.locator('option', { hasText: 'Участник второго дома' })).toHaveCount(1);
    await expect(field.locator(`option[value="${family.person('admin').id}"]`)).toHaveCount(0);
    await field.getByLabel('Ответственный').selectOption(member.id);
    await field.getByRole('button', { name: 'Сменить ответственного' }).click();
    await expect
      .poll(async () => (await api.get(endpoint ?? '')).body)
      .toMatchObject({ assigneeId: member.id });
    await expect(field.getByRole('button', { name: 'Сменить ответственного' })).toBeDisabled();
    await check(page, info, endpoint?.startsWith('objects') ? 'b4-object-h2' : 'b4-document-h2');
  }
  await api.post(`deadlines/${deadline}/assignee`, { assigneeId: family.person('adult').id });
  await page.goto(`#/home/${object.id}`);
  const field = page.locator('.deadline-item .task-responsible');
  await field.getByLabel('Ответственный').selectOption(member.id);
  await expect(field.locator(`option[value="${family.person('admin').id}"]`)).toHaveCount(0);
  await field.getByRole('button', { name: 'Сменить ответственного' }).click();
  await expect
    .poll(async () => (await api.get(`objects/${object.id}/deadlines`)).body)
    .toContainEqual(expect.objectContaining({ id: deadline, assigneeId: member.id }));
  await check(page, info, 'b4-deadline-h2');
  expect(
    (await api.post(`objects/${object.id}/assignee`, { assigneeId: family.person('admin').id }))
      .status,
  ).toBe(409);
  const other = await apiAsUser(family, 'second', password);
  expect((await other.get(`objects/${object.id}`)).status).toBe(200);
});

test('B2/A3: отказ отмены виден после ухода строки; повторный клик не отправляет второй undo', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Отказ после смены списка',
    planOn: '2030-01-02',
    repeatRule: { kind: 'daily' },
  });
  const id = (created.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await page.goto('#/today/all');
  await page.getByLabel('Статус дел').selectOption('open');
  await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  const completed = (await api.get(`tasks/${id}`)).body as { nextTaskId: string };
  expect(
    (
      await api.patch(`tasks/${completed.nextTaskId}`, {
        description: 'Содержательная правка преемника',
      })
    ).status,
  ).toBe(200);
  await page.goto('#/today/plan');
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(`/tasks/${id}/undo`)) requests++;
  });
  await page.getByRole('button', { name: 'Отменить', exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator('.toast')).toContainText('Следующее дело уже изменено');
  expect(requests).toBe(1);
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    status: 'done',
    nextTaskId: completed.nextTaskId,
  });
  await check(page, info, 'b2-undo-refusal');
});

for (const field of ['dueOn', 'checkOn'] as const)
  test(`A1: ${field} — старое дело получает дом вместе с сохранённым черновиком`, async ({
    page,
    family,
  }, info) => {
    const second = await createHousehold(createAuthDatabase(family.database.admin), 'Второй дом');
    await family.database.admin.query(
      "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
      [second, family.person('adult').id],
    );
    const api = await apiAs(family, 'adult');
    const row = (await api.post('tasks', { title: `Старое дело ${field}` })).body as { id: string };
    await family.database.admin.query('UPDATE tasks SET household_id=NULL WHERE id=$1', [row.id]);
    await signInAs(page, family, 'adult');
    await page.goto(`#/today/tasks/${row.id}`);
    await page.getByRole('button', { name: 'Править дело' }).click();
    if (field === 'checkOn') {
      await page.getByLabel('Статус', { exact: true }).selectOption('waiting');
      await page.getByLabel('Жду от участника').selectOption(family.person('adult').id);
    }
    const label = field === 'dueOn' ? 'Крайний срок' : 'Дата проверки';
    await page.getByLabel(label, { exact: true }).fill('2030-01-02');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Выберите дом');
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('2030-01-02');
    await page.getByLabel('Дом для дат').selectOption(second);
    if (field === 'checkOn') {
      await expect(page.getByLabel('Жду от участника')).toHaveValue('');
      await page.getByLabel('Жду от участника').selectOption(family.person('adult').id);
    }
    await check(page, info, `a1-${field}`);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Править дело' })).toBeVisible();
    expect((await api.get(`tasks/${row.id}`)).body).toMatchObject({
      householdId: second,
      [field]: '2030-01-02',
      status: field === 'checkOn' ? 'waiting' : 'open',
    });
  });

for (const code of ['UNDO_EXPIRED', 'COMPLETION_CHANGED'] as const)
  test(`A3: ${code} — UI показывает точную причину настоящего отказа`, async ({
    page,
    family,
  }, info) => {
    const api = await apiAs(family, 'adult');
    const row = (await api.post('tasks', { title: 'Проверка причины отмены' })).body as {
      id: string;
    };
    await signInAs(page, family, 'adult');
    await page.goto('#/today/all');
    await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
    if (code === 'UNDO_EXPIRED')
      await family.database.admin.query(
        "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
        [row.id],
      );
    else {
      const first = (await api.get(`tasks/${row.id}`)).body as { completionEventId: string };
      expect(
        (await api.post(`tasks/${row.id}/undo`, { eventId: first.completionEventId })).status,
      ).toBe(200);
      expect((await api.post(`tasks/${row.id}/status`, { status: 'done' })).status).toBe(200);
    }
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.locator('.toast')).toContainText(
      code === 'UNDO_EXPIRED' ? 'Семь секунд для отмены истекли' : 'Событие выполнения сменилось',
    );
    expect((await api.get(`tasks/${row.id}`)).body).toMatchObject({ status: 'done' });
    await check(page, info, `a3-${code}`);
  });

test('A5: быстрый ввод двух домов в разных поясах, переключение очищает чипы и назначение', async ({
  page,
  family,
}, info) => {
  const second = await createHousehold(createAuthDatabase(family.database.admin), 'Второй дом');
  await family.database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
    [second, family.person('adult').id],
  );
  await family.database.admin.query(
    "UPDATE spaces SET time_zone=CASE WHEN id=$1 THEN 'Pacific/Kiritimati' ELSE 'America/Los_Angeles' END WHERE id=ANY($2::uuid[])",
    [second, [second, family.houseId]],
  );
  await signInAs(page, family, 'adult');
  const api = await apiAs(family, 'adult');
  for (const [house, zone] of [
    [family.houseId, 'America/Los_Angeles'],
    [second, 'Pacific/Kiritimati'],
    [family.houseId, 'America/Los_Angeles'],
  ]) {
    await page.getByLabel('Выбранный дом').selectOption(house ?? '');
    const context = (await api.get(`tasks/today?householdId=${house}`)).body as {
      today: string;
      timeZone: string;
    };
    expect(context.timeZone).toBe(zone);
    await expect(page.getByLabel('Быстрая строка')).toHaveValue('');
    await page.getByLabel('Быстрая строка').fill('Позвонить завтра в 10:00');
    await page.getByRole('button', { name: /Дата:/ }).click();
    await expect(page.getByRole('dialog').getByLabel('Дата', { exact: true })).toHaveValue(
      shiftTaskDate(context.today, 1),
    );
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await check(page, info, house === second ? 'a5-second-zone' : 'a5-first-zone');
  }
  await page.getByLabel('Выбранный дом').selectOption(second);
  await page.getByLabel('Быстрая строка').fill('Сохранить завтра в 10:00');
  await page.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(page).toHaveURL(/tasks\/[a-f0-9-]+$/);
  const id = page.url().split('/').at(-1);
  const context = (await api.get(`tasks/today?householdId=${second}`)).body as { today: string };
  expect((await api.get(`tasks/${id}`)).body).toMatchObject({
    householdId: second,
    planOn: shiftTaskDate(context.today, 1),
    planTime: '10:00',
  });
});

test('A2: сроки дела и коммуналки отвечают EDIT_SOURCE и ведут к доступному источнику', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const date = localDate(new Date(), 'UTC');
  const row = (await api.post('tasks', { title: 'Источник дела', planOn: date })).body as {
    id: string;
  };
  const property = await seedProperty(api, family, {
    title: 'Источник коммуналки',
    audience: 'adults',
  });
  const account = await seedAccount(api, property.id, {
    title: 'Счёт',
    data: { number: 'TEST-2' },
  });
  const charge = await api.post(`accounts/${account.id}/charges`, {
    period: date.slice(0, 7),
    totalCents: 10000,
    dueOn: date,
  });
  expect(charge.status).toBe(201);
  const deadlines = (
    await family.database.admin.query(
      'SELECT id,source_kind FROM deadlines WHERE task_id=$1 OR charge_id=$2',
      [row.id, (charge.body as { id: string }).id],
    )
  ).rows;
  expect(deadlines).toHaveLength(2);
  for (const deadline of deadlines)
    expect(
      await api.post(`deadlines/${deadline.id}/assignee`, {
        assigneeId: family.person('adult').id,
      }),
    ).toMatchObject({ status: 409, body: { code: 'EDIT_SOURCE' } });
  const { recalc } = await import('./deadlines-support.ts');
  await recalc(family);
  await signInAs(page, family, 'adult');
  for (const [title, source] of [
    ['Источник дела', `/today/tasks/${row.id}`],
    ['Источник коммуналки', `/home/${property.id}`],
  ]) {
    await page.goto('#/more/radar');
    const item = page
      .getByRole('listitem')
      .filter({ hasText: title ?? '' })
      .first();
    await item.getByRole('link', { name: /Ответственный — в карточке источника/ }).click();
    expect(new URL(page.url()).hash).toContain(source);
  }
  await check(page, info, 'a2-utility-source');
});
