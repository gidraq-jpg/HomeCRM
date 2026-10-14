/// <reference types="vite/client" />
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAuthDatabase } from '@homecrm/db';
import type { Page, Route, TestInfo } from '@playwright/test';
import { createHousehold } from '../../../server/src/auth/provision.ts';
import { type RepeatRule, TaskCard } from '../../src/tasks/api.ts';
import { test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { collectConsole, seedDocument } from './documents-support.ts';
import { makePng } from './files-support.ts';
import {
  type Api,
  apiAs,
  expectNothingStored,
  openAs,
  seedNote,
  seedObject,
} from './notes-support.ts';
import { seedPerson } from './people-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { expect, signInAs } from './support.ts';

async function task(api: Api, input: Record<string, unknown>) {
  const response = await api.post('tasks', input);
  expect(response.status).toBe(201);
  return TaskCard.parse(response.body);
}
async function current(api: Api, id: string) {
  const response = await api.get(`tasks/${id}`);
  expect(response.status).toBe(200);
  return TaskCard.parse(response.body);
}
async function openTask(page: Page, id: string, title: string) {
  await page.goto(`#/today/tasks/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}
async function saved(page: Page, title: string) {
  await page
    .locator('form.task-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.locator('form.task-form')).toHaveCount(0);
}
async function check(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, name);
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
async function cacheContents(page: Page) {
  return page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        result.push(request.url, (await response?.text()) ?? '');
      }
    }
    return result.join('\n');
  });
}

test('три агрегированные ленты, главное, крайний срок без плана, фильтры и подгрузка', async ({
  page,
  family,
}, info) => {
  test.setTimeout(120000);
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const overdue = await task(api, { title: 'Просроченный крайний срок', dueOn: homeDate(-1) });
  await task(api, { title: 'План позже, срок прошёл', planOn: homeDate(20), dueOn: homeDate(-1) });
  const main = await task(api, { title: 'Одно главное', planOn: homeDate(0) });
  await api.post(`tasks/${main.id}/main`, { selected: true });
  for (let index = 0; index < 51; index++)
    await task(api, { title: `Дело без даты ${String(index).padStart(2, '0')}` });
  const completed = await task(api, { title: 'Выполненное свёрнуто', status: 'done' });
  const paths: string[] = [];
  const radarQueries: URLSearchParams[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      paths.push(url.pathname);
      if (url.pathname === '/api/deadlines') radarQueries.push(url.searchParams);
    }
  });
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('link', { name: /Просроченный крайний срок/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /План позже, срок прошёл/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Главное дело' }).getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Выполненное свёрнуто/ })).not.toBeVisible();
  expect(paths.filter((path) => path === '/api/tasks/today')).toHaveLength(1);
  // UI-2: один запрос радара питает показатель близких сроков под текущими фильтрами.
  expect(paths.filter((path) => path === '/api/deadlines')).toHaveLength(1);
  expect(radarQueries[0]?.get('scope')).toBe('all');
  expect(radarQueries[0]?.get('view')).toBe('mine');
  expect(radarQueries[0]?.get('householdId')).toBe(family.houseId);
  expect(paths.filter((path) => /^\/api\/tasks\/[0-9a-f-]{36}$/.test(path))).toHaveLength(0);
  await check(page, info, 'today');
  await page.getByText(/^Выполнено сегодня/).click();
  await expect(page.getByRole('link', { name: /Выполненное свёрнуто/ })).toBeVisible();
  await openTask(page, main.id, main.title);
  await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
  await expect.poll(async () => (await current(api, main.id)).isMain).toBe(false);
  await page.goto('#/today/plan');
  await expect(page.getByRole('heading', { level: 1, name: 'План', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Дела без даты' }).getByRole('link')).toHaveCount(52);
  await page.getByRole('button', { name: 'Показать следующие дни' }).click();
  await expect(page.getByRole('link', { name: /План позже, срок прошёл/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Дела без даты' }).getByRole('link')).toHaveCount(52);
  await check(page, info, 'plan');
  await page.goto('#/today/all');
  await page.getByLabel('Фильтр дел', { exact: true }).selectOption('undated');
  await expect(page.getByRole('list', { name: 'Все дела' }).getByRole('link')).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё дела' }).click();
  await expect(page.getByRole('list', { name: 'Все дела' }).getByRole('link')).toHaveCount(53);
  await check(page, info, 'all');
  await page.getByLabel('Статус дел').selectOption('done');
  await expect(page.getByRole('list', { name: 'Все дела' }).getByRole('link')).toHaveCount(1);
  expect((await current(api, completed.id)).status).toBe('done');
  expect((await current(api, overdue.id)).planOn).toBeNull();
});

test('создание, чек-лист и ожидание сохраняются; конфликт не затирает другой чек-лист', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await page.goto('#/today/new');
  await page.getByLabel('Название дела').fill('Позвонить мастеру');
  await page.getByLabel('Описание').fill('Вымышленный ремонт');
  await page.getByLabel('Дата плана', { exact: true }).fill(homeDate(0));
  await page.getByLabel('Время плана', { exact: true }).fill('18:30');
  await page.getByLabel('Крайний срок', { exact: true }).fill(homeDate(1));
  await page.getByLabel('Новый пункт').fill('Подготовить вопросы');
  await page.getByRole('button', { name: 'Добавить пункт' }).click();
  await page.getByLabel('Новый пункт').fill('Проверить смету');
  await page.getByRole('button', { name: 'Добавить пункт' }).click();
  await page.getByRole('button', { name: 'Пункт 2 выше' }).click();
  await page.getByLabel('Пункт 1', { exact: true }).fill('Сравнить смету');
  await page.getByLabel('Статус', { exact: true }).selectOption('waiting');
  await page.getByLabel('Жду от участника').selectOption(family.person('admin').id);
  await page.getByLabel('Дата проверки').fill(homeDate(1));
  await check(page, info, 'create-waiting');
  await saved(page, 'Позвонить мастеру');
  const id = page.url().split('/').at(-1) ?? '';
  const original = await current(api, id);
  expect(original.checklist.map((item) => item.title)).toEqual([
    'Сравнить смету',
    'Подготовить вопросы',
  ]);
  expect(original.waitingAccountId).toBe(family.person('admin').id);
  await check(page, info, 'card-waiting');
  await page.getByRole('checkbox', { name: 'Сравнить смету' }).click();
  await expect.poll(async () => (await current(api, id)).checklist[0]?.done).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Сравнить смету' })).toBeChecked();
  await page.getByRole('button', { name: 'Править дело' }).click();
  await page.getByLabel('Пункт 1', { exact: true }).fill('Мой черновик');
  const latest = await current(api, id);
  expect(
    (
      await api.patch(`tasks/${id}`, {
        checklist: latest.checklist.map((item) => ({ ...item, title: 'Другая версия' })),
        expectedUpdatedAt: latest.updatedAt,
      })
    ).status,
  ).toBe(200);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText(/Дело изменили на другом устройстве/)).toBeVisible();
  await expect(page.getByLabel('Пункт 1', { exact: true })).toHaveValue('Мой черновик');
  expect((await current(api, id)).checklist[0]?.title).toBe('Другая версия');
  await page.getByRole('button', { name: 'Отбросить черновик и обновить' }).click();
  await expect(page.getByRole('checkbox', { name: 'Другая версия' })).toHaveCount(2);
});

test('быстрая строка: снятие и правка чипа, транспортный повтор, Enter без дубля', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  const input = page.getByLabel('Быстрая строка');
  await input.fill('Написать завтра в 10:00 @Вера');
  await expect(page.getByRole('button', { name: 'Снять чип: Дата' })).toBeVisible();
  await page.getByRole('button', { name: 'Снять чип: Дата' }).click();
  await expect(page.getByRole('button', { name: 'Снять чип: Дата' })).toHaveCount(0);
  await expect(input).toHaveValue('Написать завтра в 10:00 @Вера');
  // Без даты время нельзя сохранить: снятие даты сохраняет распознанное время в исходном тексте.
  await page.getByRole('button', { name: 'Снять чип: Время' }).click();
  await page.getByRole('button', { name: 'Снять чип: Исполнитель' }).click();
  await input.fill('Написать завтра в 10:00');
  await page.getByRole('button', { name: /^Дата:/ }).click();
  await page.getByRole('dialog').getByLabel('Дата', { exact: true }).fill(homeDate(2));
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Дата:/ })).toHaveText(/Дата: \d{1,2} [а-я]/);
  await expect(page.getByRole('button', { name: /^Дата:/ })).not.toHaveText(/\d{4}-\d{2}-\d{2}/);
  await check(page, info, 'quickline-chips');
  const requests: Record<string, unknown>[] = [];
  let lose = true;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON());
    if (lose) {
      lose = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await input.press('Enter');
  await expect(page.getByText(/Не удалось связаться с сервером/)).toBeVisible();
  await expect(input).toHaveValue('Написать завтра в 10:00');
  await expect(page.getByRole('button', { name: /^Дата:/ })).toBeVisible();
  await input.press('Enter');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Написать', exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]?.idempotencyKey).toBe(requests[1]?.idempotencyKey);
  const list = await api.get('tasks');
  expect(TaskCard.array().parse(list.body)).toHaveLength(1);
  expect(TaskCard.array().parse(list.body)[0]?.planOn).toBe(homeDate(2));
});

const rules: RepeatRule[] = [
  { kind: 'daily' },
  { kind: 'weekly', weekdays: [1, 3] },
  { kind: 'monthly', day: 'last' },
  { kind: 'monthly', day: 31 },
  { kind: 'yearly', month: 2, day: 29 },
  { kind: 'every_days', days: 3 },
  { kind: 'after_done', days: 5 },
];
for (const rule of rules)
  test(`форма повтора ${rule.kind}${rule.kind === 'monthly' ? `-${rule.day}` : ''}: все три политики`, async ({
    page,
    family,
  }, info) => {
    test.setTimeout(120000);
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    await signInAs(page, family, 'adult');
    for (const policy of ['keep', 'roll_forward', 'not_done']) {
      await page.goto('#/today/new');
      const title = `Повтор ${rule.kind} ${policy}`;
      await page.getByLabel('Название дела').fill(title);
      await page.getByLabel('Расписание', { exact: true }).selectOption(rule.kind);
      await page.getByLabel('Начальная дата / план').fill(homeDate(0));
      if (rule.kind === 'weekly')
        await page.getByRole('checkbox', { name: 'Ср', exact: true }).check();
      if (rule.kind === 'monthly') {
        await page
          .getByLabel('День месяца', { exact: true })
          .selectOption(rule.day === 'last' ? 'last' : 'number');
        if (rule.day !== 'last')
          await page.getByLabel('Число месяца (1–31)').fill(String(rule.day));
      }
      if (rule.kind === 'yearly') {
        await page.getByLabel('Месяц (1–12)').fill('2');
        await page.getByLabel('День (1–31)').fill('29');
      }
      if (rule.kind === 'every_days' || rule.kind === 'after_done')
        await page.getByLabel('Число дней (1–3650)').fill(String(rule.days));
      await page.getByLabel('Если пропущено').selectOption(policy);
      if (policy === 'keep')
        await check(
          page,
          info,
          `repeat-${rule.kind}${rule.kind === 'monthly' ? `-${rule.day}` : ''}`,
        );
      await saved(page, title);
      const id = page.url().split('/').at(-1) ?? '';
      const row = await current(api, id);
      expect(row.repeatRule).toEqual(rule);
      expect(row.overduePolicy).toBe(policy);
    }
  });

test('серия: область правки, выполнение и отмена, изменённый преемник блокирует отмену', async ({
  page,
  family,
  context,
}, info) => {
  let stage = 'setup';
  let heldSnapshots = 0;
  let deliveredSnapshots = 0;
  const technical: Record<string, string | number | boolean> = {};
  try {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    const row = await task(api, {
      title: 'Ежедневная проверка',
      planOn: homeDate(0),
      repeatRule: { kind: 'daily' },
      checklist: [{ id: crypto.randomUUID(), title: 'Один пункт', done: true, position: 0 }],
    });
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      const base = `/api/tasks/${row.id}`;
      const operation =
        path === base
          ? 'task'
          : path === `${base}/status`
            ? 'status'
            : path === `${base}/undo`
              ? 'undo'
              : null;
      if (!operation) return;
      technical[`${operation}HttpStatus`] = response.status();
      if (response.status() >= 400) {
        void response
          .json()
          .then((body) => {
            const code = body?.code ?? body?.error?.code;
            technical[`${operation}Code`] =
              typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'UNAVAILABLE';
          })
          .catch(() => {
            technical[`${operation}Code`] = 'UNAVAILABLE';
          });
      }
    });
    stage = 'open';
    await signInAs(page, family, 'adult');
    await openTask(page, row.id, row.title);
    stage = 'edit-instance';
    await page.getByRole('button', { name: 'Править дело' }).click();
    await page.getByLabel('Название дела').fill('Только этот экземпляр');
    await saved(page, 'Только этот экземпляр');
    stage = 'restore-following-draft';
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
    // Пока чтение draft задержано, ввод не должен быть перезаписан поздним восстановлением.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((ok, bad) => {
        const request = indexedDB.open('homecrm-offline');
        request.onsuccess = () => ok(request.result);
        request.onerror = () => bad(request.error);
      });
      const tx = db.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      let released = false;
      window.addEventListener(
        'homecrm-test-release-draft',
        () => {
          released = true;
        },
        { once: true },
      );
      tx.oncomplete = () => db.close();
      const keepActive = () => {
        const request = store.get('homecrm-test-restore-gate');
        request.onsuccess = () => {
          if (!released) keepActive();
        };
      };
      keepActive();
    });
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect(page.getByLabel('Название дела')).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('homecrm-test-release-draft')));
    await page.getByLabel('Область правки серии').selectOption('following');
    await page.getByLabel('Название дела').fill('Все следующие');
    await expect(
      page.locator('form.task-form').getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeEnabled();
    // Подтверждённая карточка остаётся в UI; её offline snapshot может быть вытеснен.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((ok, bad) => {
        const request = indexedDB.open('homecrm-offline');
        request.onsuccess = () => ok(request.result);
        request.onerror = () => bad(request.error);
      });
      await new Promise<void>((ok, bad) => {
        const tx = db.transaction(['snapshots', 'drafts'], 'readwrite');
        tx.objectStore('snapshots').clear();
        tx.objectStore('drafts').clear();
        tx.oncomplete = () => ok();
        tx.onerror = () => bad(tx.error);
      });
      db.close();
    });
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((ok) => {
      releaseSnapshot = ok;
    });
    let snapshotUrl = '';
    let holdLateSnapshot = false;
    let lateSnapshotStarted = false;
    let releaseLateSnapshot!: () => void;
    const lateSnapshotGate = new Promise<void>((ok) => {
      releaseLateSnapshot = ok;
    });
    const inFlight = new Set<Promise<void>>();
    const handleSnapshot = async (route: Route) => {
      const response = await route.fetch();
      const wrapper = await response.json();
      if (wrapper.data?.title !== 'Все следующие') return route.fulfill({ response });
      snapshotUrl = route.request().url();
      heldSnapshots++;
      await snapshotGate;
      if (holdLateSnapshot) {
        holdLateSnapshot = false;
        lateSnapshotStarted = true;
        await lateSnapshotGate;
      }
      await route.fulfill({ response });
      deliveredSnapshots++;
    };
    const snapshotHandler = (route: Route) => {
      const invocation = handleSnapshot(route);
      inFlight.add(invocation);
      technical.inFlight = inFlight.size;
      const completed = () => {
        inFlight.delete(invocation);
        technical.inFlight = inFlight.size;
      };
      void invocation.then(completed, completed);
      return invocation;
    };
    await context.route(`**/api/tasks/${row.id}?*`, snapshotHandler);
    let cleanupPromise: Promise<void> | undefined;
    let routeRemoved = false;
    let cleanupFinished = false;
    const cleanupSnapshots = () => {
      cleanupPromise ??= (async () => {
        // До снятия своего handler завершаем его активные вызовы, включая поздний GET.
        while (inFlight.size > 0) await Promise.all([...inFlight]);
        await context.unroute(`**/api/tasks/${row.id}?*`, snapshotHandler);
        routeRemoved = true;
        cleanupFinished = true;
      })();
      return cleanupPromise;
    };
    try {
      stage = 'save-following';
      const acknowledgment = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.request().url().endsWith(`/api/tasks/${row.id}`) &&
          response.request().postDataJSON()?.repeatScope === 'following',
      );
      await page
        .locator('form.task-form')
        .getByRole('button', { name: 'Сохранить', exact: true })
        .click();
      technical.followingHttpStatus = (await acknowledgment).status();
      expect(technical.followingHttpStatus).toBe(200);
      stage = 'whole-following-snapshot';
      await page.clock.resume();
      await expect.poll(() => heldSnapshots).toBeGreaterThan(0);
      await expect(page.locator('form.task-form')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Выполнить', exact: true })).toHaveCount(0);
      releaseSnapshot();
      await expect.poll(() => deliveredSnapshots === heldSnapshots).toBe(true);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Все следующие', exact: true }),
      ).toBeVisible();
      await expect(page.locator('form.task-form')).toHaveCount(0);
      // Поздний реальный GET уже in-flight при снятии handler; cleanup обязан дождаться ACK.
      stage = 'late-snapshot-cleanup';
      holdLateSnapshot = true;
      const lateFetch = page.evaluate(
        (url) => fetch(url).then((response) => response.status),
        snapshotUrl,
      );
      await expect.poll(() => lateSnapshotStarted).toBe(true);
      const cleanup = cleanupSnapshots();
      expect(routeRemoved).toBe(false);
      expect(cleanupFinished).toBe(false);
      expect(inFlight.size).toBeGreaterThan(0);
      releaseLateSnapshot();
      await cleanup;
      expect(routeRemoved).toBe(true);
      expect(await lateFetch).toBe(200);
      expect(inFlight.size).toBe(0);
      await expect.poll(() => deliveredSnapshots === heldSnapshots).toBe(true);
    } finally {
      releaseSnapshot();
      releaseLateSnapshot();
      await page.clock.resume();
      await cleanupSnapshots();
      await expect.poll(() => deliveredSnapshots === heldSnapshots).toBe(true);
    }
    stage = 'first-done';
    await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
    await expect(page.getByRole('button', { name: /Отменить выполнение/ })).toBeVisible();
    const done = await current(api, row.id);
    technical.firstDoneStatus = done.status;
    technical.nextExists = Boolean(done.nextTaskId);
    expect(done.nextTaskId).toBeTruthy();
    const next = await current(api, done.nextTaskId ?? '');
    expect(next.title).toBe('Все следующие');
    expect(next.checklist[0]?.done).toBe(false);
    expect(next.files).toHaveLength(0);
    expect(next.waitingFrom).toBeNull();
    stage = 'first-undo';
    await page.getByRole('button', { name: /Отменить выполнение/ }).click();
    await expect.poll(async () => (await current(api, row.id)).status).toBe('open');
    expect((await current(api, next.id)).deletedAt).not.toBeNull();
    stage = 'second-done';
    await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
    await expect(page.getByRole('button', { name: /Отменить выполнение/ })).toBeVisible();
    const second = await current(api, row.id);
    technical.secondDoneStatus = second.status;
    stage = 'edit-next';
    expect(second.status).toBe('done');
    expect(
      (await api.patch(`tasks/${second.nextTaskId}`, { title: 'Изменённый преемник' })).status,
    ).toBe(200);
    await page.getByRole('button', { name: /Отменить выполнение/ }).click();
    stage = 'conflicting-undo';
    await expect(page.getByRole('alert')).toContainText(/измен|Отмена/);
    expect((await current(api, row.id)).status).toBe('done');
    expect((await current(api, second.nextTaskId ?? '')).deletedAt).toBeNull();
    stage = 'accessibility';
    await check(page, info, 'undo-conflict');
  } catch (error) {
    // До отмены всего CI печатаем только технические признаки; исходную ошибку не меняем.
    const message = error instanceof Error ? error.message : '';
    const matcher = message.match(
      /expect\([^\r\n]*?\)\.(toBe|toEqual|toHaveCount|toBeDisabled|toBeVisible|toContainText|toBeTruthy|toBeNull|toHaveLength|toBeGreaterThan|toBeEnabled)\(/,
    )?.[1];
    const timeout = message.match(/Timeout (\d+)ms exceeded/)?.[1];
    const source = [
      ...(error instanceof Error ? (error.stack ?? '') : '').matchAll(
        /tasks\.e2e\.ts:(\d+):(\d+)/g,
      ),
    ].map((match) => `tasks.e2e.ts:${match[1]}:${match[2]}`);
    const ui = await page
      .evaluate(() => {
        const controls = [
          ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
            'form.task-form input,form.task-form textarea,form.task-form select',
          ),
        ];
        const buttons = [...document.querySelectorAll('button')];
        return {
          available: true,
          forms: document.querySelectorAll('form.task-form').length,
          editableControls: controls.length,
          disabledControls: controls.filter((control) => control.disabled).length,
          doneButtons: buttons.filter((button) => button.textContent?.trim() === 'Выполнить')
            .length,
          undoButtons: buttons.filter((button) =>
            button.textContent?.includes('Отменить выполнение'),
          ).length,
          alerts: document.querySelectorAll('[role="alert"]').length,
        };
      })
      .catch(() => ({ available: false }));
    console.error(
      'Series technical failure',
      JSON.stringify({
        stage,
        source,
        message: matcher
          ? `expect.${matcher}`
          : timeout
            ? `Timeout ${timeout}ms exceeded`
            : 'Assertion or action failed',
        technical,
        heldSnapshots,
        deliveredSnapshots,
        ui,
      }),
    );
    throw error;
  }
});

test('серия: возобновление после окна и отмена повторного выполнения сохраняют прежнего преемника', async ({
  page,
  family,
  context,
}) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const row = await task(api, {
    title: 'Прежний экземпляр',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
  });
  const first = TaskCard.parse((await api.post(`tasks/${row.id}/status`, { status: 'done' })).body);
  await family.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [row.id],
  );
  expect(
    await api.post(`tasks/${row.id}/undo`, { eventId: first.completionEventId }),
  ).toMatchObject({ status: 409, body: { code: 'UNDO_EXPIRED' } });
  await api.patch(`tasks/${first.nextTaskId}`, { title: 'Сохранённый преемник' });
  await signInAs(page, family, 'adult');
  await openTask(page, row.id, row.title);
  let snapshotStarted = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route(`**/api/tasks/${row.id}?*`, async (route) => {
    if (snapshotStarted) return route.continue();
    snapshotStarted = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Возобновить дело' }).click();
    await expect.poll(() => snapshotStarted).toBe(true);
    await expect(page.getByRole('button', { name: 'Выполнить', exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole('button', { name: 'Выполнить', exact: true })).toBeEnabled();
  } finally {
    release();
    await context.unroute(`**/api/tasks/${row.id}?*`);
  }
  await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
  await expect(page.getByRole('button', { name: /Отменить выполнение/ })).toBeVisible();
  const second = await current(api, row.id);
  expect(second.nextTaskId).toBe(first.nextTaskId);
  await page.getByRole('button', { name: /Отменить выполнение/ }).click();
  await expect.poll(async () => (await current(api, row.id)).status).toBe('open');
  const successor = await current(api, first.nextTaskId ?? '');
  expect(successor.deletedAt).toBeNull();
  expect(successor.title).toBe('Сохранённый преемник');
  await page.goto('#/today/plan');
  await expect(page.getByRole('link', { name: /Сохранённый преемник/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Прежний экземпляр/ })).toHaveCount(0);
});

test('прекращение повтора, корзина и восстановление серии отдельным маршрутом', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const row = await task(api, {
    title: 'Серия в корзину',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
  });
  await signInAs(page, family, 'adult');
  await openTask(page, row.id, row.title);
  await page.getByRole('button', { name: 'В корзину всю серию' }).click();
  await expect(page.getByRole('button', { name: 'Восстановить серию' })).toBeVisible();
  await page.goto('#/more/trash');
  await expect(page.getByRole('link', { name: /Серия в корзину/ })).toBeVisible();
  await check(page, info, 'trash');
  await page.getByRole('link', { name: /Серия в корзину/ }).click();
  const request = page.waitForRequest((request) =>
    request.url().endsWith(`/tasks/${row.id}/series/restore`),
  );
  await page.getByRole('button', { name: 'Восстановить серию' }).click();
  await request;
  await expect(page.getByRole('button', { name: 'Править дело' })).toBeVisible();
  await page.getByRole('button', { name: 'Править дело' }).click();
  await page.getByLabel('Область правки серии').selectOption('following');
  await page.getByLabel('Расписание', { exact: true }).selectOption('');
  await saved(page, row.title);
  expect((await current(api, row.id)).repeatRule).toBeNull();
});

test('назначение ребёнку: отказ сохраняет форму, подтверждение расширяет доступ без второго дела', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await page.goto('#/today/new');
  await page.getByLabel('Название дела').fill('Дело для Веры');
  await page.getByLabel('Описание').fill('Сохранить этот черновик');
  await page.getByLabel('Исполнитель', { exact: true }).selectOption(family.person('child').id);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтвердите доступ' });
  await expect(confirmation).toContainText('Вся семья');
  await expect(confirmation).toContainText('Вера');
  await check(page, info, 'audience-confirmation');
  await page.getByRole('button', { name: 'Оставить прежний доступ' }).click();
  await expect(page.getByLabel('Описание')).toHaveValue('Сохранить этот черновик');
  expect(TaskCard.array().parse((await api.get('tasks')).body)).toHaveLength(0);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить и передать' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Дело для Веры', exact: true }),
  ).toBeVisible();
  const rows = TaskCard.array().parse((await api.get('tasks')).body);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.audience).toBe('household');
  expect(rows[0]?.assigneeId).toBe(family.person('child').id);
});

test('передача снимает главное; личное взрослого и «Взрослые» скрыты администратору и ребёнку по правилам', async ({
  page,
  browser,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const privateRow = await task(api, {
    title: 'Приватный текст Бориса',
    description: 'Приватное описание',
  });
  const adults = await task(api, {
    title: 'Только взрослые видят',
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const shared = await task(api, {
    title: 'Передать общее дело',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await api.post(`tasks/${shared.id}/main`, { selected: true });
  const logs = collectConsole(page);
  await signInAs(page, family, 'adult');
  await openTask(page, shared.id, shared.title);
  await page.getByRole('button', { name: 'Передать…' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Исполнитель', { exact: true })
    .selectOption(family.person('child').id);
  await page.getByRole('button', { name: 'Передать выбранному' }).click();
  await expect
    .poll(async () => (await current(api, shared.id)).assigneeId)
    .toBe(family.person('child').id);
  expect((await current(api, shared.id)).isMain).toBe(false);
  for (const role of ['admin', 'child'] as const) {
    const other = await openAs(browser, family, info, role);
    try {
      await other.page.goto('#/today/all');
      await expect(other.page.getByRole('link', { name: /Передать общее дело/ })).toBeVisible();
      await expect(other.page.getByText(privateRow.title)).toHaveCount(0);
      if (role === 'child') await expect(other.page.getByText(adults.title)).toHaveCount(0);
      await other.page.goto(`#/open/${privateRow.id}`);
      await expect(
        other.page.getByText('Записи больше нет, или она стала вам недоступна.'),
      ).toBeVisible();
      await expectNothingStored(other.page, [privateRow.title, 'Приватное описание']);
      expect(await cacheContents(other.page)).not.toContain(privateRow.title);
    } finally {
      await other.close();
    }
  }
  expect(logs.join('\n')).not.toContain('Приватное описание');
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await signInAs(page, family, 'child');
  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: /Передать общее дело/ })).toBeVisible();
  await expect(page.getByText(privateRow.title)).toHaveCount(0);
  expect(await cacheContents(page)).not.toContain(privateRow.title);
});

test('поиск и уведомление открывают дело; радар дважды возвращает то же дело', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const row = await task(api, { title: 'Поисковое поручение', planOn: homeDate(0) });
  const note = await seedNote(api, family, { title: 'Срок из заметки' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(-1) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await page.goto('#/search');
  await page.getByLabel('Что найти', { exact: true }).fill('Поисковое');
  await page.getByRole('link', { name: /Поисковое поручение/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: row.title })).toBeVisible();
  await page.goto(`#/open/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title })).toBeVisible();
  const radar = await api.get(`deadlines?from=2000-01-01&to=${homeDate(1)}`);
  const occurrence = (radar.body as { items: { id: string; noteId: string }[] }).items.find(
    (item) => item.noteId === note.id,
  );
  expect(occurrence).toBeTruthy();
  await page.goto('#/more/radar');
  const item = page.getByRole('listitem').filter({ hasText: 'Срок из заметки' });
  await item.getByRole('button', { name: 'Взять в работу' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Срок из заметки', exact: true }),
  ).toBeVisible();
  const taskId = page.url().split('/').at(-1);
  await page.goto('#/more/radar');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Срок из заметки' })
    .getByRole('button', { name: 'Взять в работу' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/today/tasks/${taskId}$`));
  await check(page, info, 'from-radar');
});

test('файлы и все четыре связи дела; выбранный контакт вне первой страницы сохраняется', async ({
  page,
  family,
}, info) => {
  test.setTimeout(120000);
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const row = await task(api, { title: 'Дело со связями' });
  const object = await seedProperty(api, family, { title: 'Объект связи', audience: 'adults' });
  const account = await seedAccount(api, object.id, {
    title: 'Счёт связи',
    data: { number: 'TEST-1' },
  });
  const charge = await api.post(`accounts/${account.id}/charges`, {
    period: homeDate(0).slice(0, 7),
    totalCents: 10000,
    dueOn: homeDate(1),
  });
  expect(charge.status).toBe(201);
  const document = await seedDocument(api, {
    title: 'Документ связи',
    type: 'other',
    indefinite: true,
  });
  let contact = '';
  for (let index = 0; index < 52; index++) {
    const person = await seedPerson(api, { title: `Контакт ${String(index).padStart(2, '0')}` });
    contact = person.id;
  }
  await signInAs(page, family, 'adult');
  await openTask(page, row.id, row.title);
  for (const [kind, id] of [
    ['object', object.id],
    ['document', document.id],
    ['contact', contact],
    ['utility_charge', (charge.body as { id: string }).id],
  ]) {
    await page.getByRole('button', { name: 'Добавить связь…' }).click();
    await page.getByLabel('Вид связи').selectOption(kind ?? 'object');
    if (kind === 'utility_charge')
      await page.getByLabel('Лицевой счёт начисления').selectOption(account.id);
    if (kind === 'contact')
      await page.getByRole('button', { name: 'Ещё варианты: запись для связи' }).click();
    await page.getByLabel('Запись для связи').selectOption(id ?? '');
    await page.getByRole('button', { name: 'Связать', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.locator('.task-link-row')).toHaveCount(4);
  await page.locator('input[type=file]').setInputFiles({
    name: 'Вымышленный-файл.png',
    mimeType: 'image/png',
    buffer: makePng(16, 16),
  });
  await expect(page.getByText('Вымышленный-файл.png', { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await current(api, row.id)).files.length).toBe(1);
  await check(page, info, 'links-files');
});

test('ответственный объекта, документа и ручного срока; невидящий получает отказ', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedObject(api, family, {
    title: 'Ответственный объект',
    audience: 'adults',
  });
  const document = await seedDocument(api, {
    title: 'Ответственный документ',
    type: 'other',
    indefinite: true,
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const deadline = await seedDeadline(api, 'objects', object.id, {
    kind: 'date',
    date: homeDate(0),
  });
  await signInAs(page, family, 'adult');
  for (const [path, endpoint] of [
    [`/home/${object.id}`, `objects/${object.id}`],
    [`/documents/${document.id}`, `documents/${document.id}`],
  ]) {
    await page.goto(`#${path}`);
    const field = page.locator('.task-responsible').first();
    await field
      .getByLabel('Ответственный', { exact: true })
      .selectOption(family.person('admin').id);
    const request = page.waitForRequest((request) =>
      request.url().endsWith(`/${endpoint}/assignee`),
    );
    await field.getByRole('button', { name: 'Сменить ответственного' }).click();
    expect((await request).postDataJSON()).toEqual({ assigneeId: family.person('admin').id });
    await field
      .getByLabel('Ответственный', { exact: true })
      .selectOption(family.person('child').id);
    await field.getByRole('button', { name: 'Сменить ответственного' }).click();
    await expect(field.getByRole('alert')).toBeVisible();
  }
  await page.goto(`#/home/${object.id}`);
  const deadlineField = page.locator('.deadline-item .task-responsible');
  await deadlineField
    .getByLabel('Ответственный', { exact: true })
    .selectOption(family.person('adult').id);
  await deadlineField.getByRole('button', { name: 'Сменить ответственного' }).click();
  await expect
    .poll(
      async () =>
        (
          (await api.get(`objects/${object.id}/deadlines`)).body as {
            id: string;
            assigneeId: string;
          }[]
        ).find((row) => row.id === deadline)?.assigneeId,
    )
    .toBe(family.person('adult').id);
  await check(page, info, 'responsible');
});

test('скрытый адресат ожидания сохраняется при обычной правке; скрытая связь не раскрывается', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const contact = await seedPerson(api, { title: 'Скрытый мастер' });
  const row = await task(api, {
    title: 'Жду без раскрытия адресата',
    status: 'waiting',
    waitingContactId: contact.id,
    checkOn: homeDate(1),
    placement: { spaceId: family.houseId, audience: 'household' },
    assigneeId: family.person('child').id,
    links: [{ type: 'contact', id: contact.id }],
  });
  await signInAs(page, family, 'child');
  await openTask(page, row.id, row.title);
  await expect(page.getByText('Скрытый мастер', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Править дело' }).click();
  await expect(page.getByText(/Прежний адресат недоступен/)).toBeVisible();
  await page.getByLabel('Описание').fill('Обычная правка');
  const request = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/tasks/${row.id}`),
  );
  await saved(page, row.title);
  expect((await request).postDataJSON()).not.toHaveProperty('waitingContactId');
  const stored = await family.database.admin.query(
    'SELECT waiting_contact_id FROM tasks WHERE id=$1',
    [row.id],
  );
  expect(stored.rows[0]?.waiting_contact_id).toBe(contact.id);
  await check(page, info, 'hidden-waiting');
});

test('A1: HOUSE_REQUIRED сохраняет черновик старого дела и повтор с выбранным домом успешен', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const row = await task(api, { title: 'Старое дело без дома' });
  const secondHouse = await createHousehold(
    createAuthDatabase(family.database.admin),
    'Второй вымышленный дом',
  );
  await family.database.admin.query(
    'INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,$3)',
    [secondHouse, family.person('adult').id, 'adult'],
  );
  await family.database.admin.query('UPDATE tasks SET household_id=NULL WHERE id=$1', [row.id]);
  // Старое личное дело и два действующих дома: выбор сервером неоднозначен.
  const missing = await api.patch(`tasks/${row.id}`, { planOn: homeDate(0) });
  expect(missing).toMatchObject({ status: 400, body: { code: 'HOUSE_REQUIRED' } });
  await signInAs(page, family, 'adult');
  await openTask(page, row.id, row.title);
  await page.getByRole('button', { name: 'Править дело' }).click();
  await page.getByLabel('Дата плана', { exact: true }).fill(homeDate(0));
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Выберите дом/);
  await expect(page.getByLabel('Дата плана', { exact: true })).toHaveValue(homeDate(0));
  await check(page, info, 'house-required');
  await page.getByLabel('Дом для дат').selectOption(secondHouse);
  await saved(page, row.title);
  expect(await current(api, row.id)).toMatchObject({
    householdId: secondHouse,
    planOn: homeDate(0),
  });
});

test('производный срок: отдельная смена ответственного запрещена, ссылка ведёт к источнику', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const doc = await seedDocument(api, {
    title: 'Срок документа-источника',
    expiresOn: homeDate(0),
  });
  await recalc(family);
  const stored = await family.database.admin.query(
    'SELECT id FROM deadlines WHERE document_id=$1 AND deleted_at IS NULL',
    [doc.id],
  );
  const id = stored.rows[0]?.id as string;
  expect(id).toBeTruthy();
  expect(
    await api.post(`deadlines/${id}/assignee`, { assigneeId: family.person('adult').id }),
  ).toMatchObject({ status: 409, body: { code: 'EDIT_SOURCE' } });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/radar');
  const item = page.getByRole('listitem').filter({ hasText: doc.title });
  await item.getByRole('link', { name: /Ответственный — в карточке источника/ }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: doc.title })).toBeVisible();
  await check(page, info, 'derived-source');
});
