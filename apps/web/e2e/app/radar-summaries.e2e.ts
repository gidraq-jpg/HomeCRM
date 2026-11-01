import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CalendarDate,
  calendarInstant,
  OfflineSnapshot,
  RadarResponse,
  shiftTaskDate,
} from '@homecrm/shared';
import type { APIResponse, Page, Response, TestInfo } from '@playwright/test';
import { scheduleSummaries } from '../../../server/src/notifications/summaries.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import {
  homeDate,
  openRadar,
  openRadarMenu,
  recalc,
  seedDeadline,
  selectRadarState,
  setHomeZone,
} from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await expectAccessible(page, name);
  await expectTouchTargets(page);
  await expectNoHorizontalScroll(page);
  if (process.platform === 'linux') {
    const dir = resolve(
      import.meta.dirname,
      '../../test-results/screens/R1c.5-6',
      info.project.name,
    );
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
  }
}
test('радар: причина, настоящий 409 с сохранением формы, возврат и отложенное наступление', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Вымышленная проверка радара',
    audience: 'household',
  });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: /^Вымышленная проверка радара/ }) });
  await openRadarMenu(page, row);
  await page.getByRole('dialog').getByRole('button', { name: 'Не актуально', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Причина', { exact: true })
    .fill('Вымышленная причина сохранена');
  await check(page, info, 'radar-dismiss-form');
  const result = await api.get('deadlines?from=0001-01-01&to=9999-12-31');
  const item = (result.body as { items: { id: string; calendarKey: string }[] }).items[0];
  if (!item) throw new Error('Missing fixture occurrence');
  expect(
    (
      await api.post(`deadlines/occurrences/${item.id}/action`, {
        action: 'dismiss',
        reason: 'Правка второго устройства',
        calendarKey: item.calendarKey,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(200);
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Текущая версия: 1');
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Причина', exact: true }),
  ).toHaveValue('Вымышленная причина сохранена');
  await check(page, info, 'radar-conflict');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(row).toHaveCount(0);
  await selectRadarState(page, 'dismissed');
  await expect(row).toContainText('Вымышленная причина сохранена');
  await check(page, info, 'radar-dismissed');
  await openRadarMenu(page, row);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Вернуть в радар', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await selectRadarState(page, 'active');
  await openRadarMenu(page, row);
  await page.getByRole('dialog').getByRole('button', { name: 'Отложить до…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Дата · Europe/Moscow', { exact: true })
    .fill(homeDate(2));
  await page.getByRole('dialog').getByLabel('Время дома', { exact: true }).fill('09:30');
  await check(page, info, 'radar-snooze-form');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(row).toHaveCount(0);
  await selectRadarState(page, 'snoozed');
  await expect(row).toContainText('Отложено до');
  await page.reload();
  await expect(row).toHaveCount(0);
  await selectRadarState(page, 'snoozed');
  await expect(row).toContainText('Отложено до');
  await check(page, info, 'radar-snoozed');
});
test('сводка внутри приложения и отдельные настройки при нулевом бюджете', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Вымышленное срочное обязательство' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(-2) });
  await recalc(family);
  await scheduleSummaries(family.database.worker, new Date(Date.now() + 86400000));
  const result = await api.get('summaries');
  const summaries = result.body as { id: string; kind: string }[];
  const summary = summaries.find((s) => s.kind === 'morning');
  if (!summary) throw new Error('Missing morning summary');
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/summaries/${summary.id}`);
  await expect(page.getByRole('heading', { name: 'Срочное', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Вымышленное срочное обязательство/ }),
  ).toBeVisible();
  await check(page, info, 'summary-morning');
  await page.goto('#/more/notifications');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Уведомления', exact: true }),
  ).toBeVisible();
  const kind = page.getByRole('checkbox', { name: /^Срок документа/ });
  await kind.uncheck();
  await kind.check();
  await expect(
    page.getByRole('button', { name: 'Сохранить настройки', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Сколько уведомлений в день', { exact: true }).fill('0');
  await page.getByRole('checkbox', { name: /Утренняя · 08:00 дома/ }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByText('Настройки уведомлений сохранены', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Утренняя · 08:00 дома/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Недельная · воскресенье 19:00/ })).toBeChecked();
  await check(page, info, 'summary-settings');
  await page.getByRole('link', { name: 'Открыть сводки', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Сводки', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Утренняя/ })).toBeVisible();
  await check(page, info, 'summary-list');
});
test('недельная сводка показывает сделано, на подходе и ожидание сегодня один раз', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const made = await api.post('tasks', {
    title: 'Вымышленное выполненное дело недели',
    householdId: family.houseId,
    planOn: homeDate(0),
  });
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  expect((await api.post(`tasks/${id}/status`, { status: 'done' })).status).toBe(200);
  expect(
    (
      await api.post('tasks', {
        title: 'Вымышленное ожидание проверки',
        householdId: family.houseId,
        status: 'waiting',
        checkOn: homeDate(0),
        dueOn: homeDate(0),
        planOn: homeDate(0),
        waitingAccountId: family.person('admin').id,
      })
    ).status,
  ).toBe(201);
  await recalc(family);
  const today = homeDate(0),
    weekday = new Date(`${today}T12:00Z`).getUTCDay();
  let end = calendarInstant(
    CalendarDate.parse(shiftTaskDate(today, (7 - weekday) % 7)),
    'Europe/Moscow',
    '19:00',
  );
  if (end <= new Date())
    end = calendarInstant(CalendarDate.parse(shiftTaskDate(today, 7)), 'Europe/Moscow', '19:00');
  await scheduleSummaries(family.database.worker, end);
  const list = (await api.get('summaries')).body as { id: string; kind: string }[];
  const weekly = list.find((x) => x.kind === 'weekly');
  if (!weekly) throw new Error('Missing weekly summary');
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/summaries/${weekly.id}`);
  for (const title of ['Что сделано', 'На подходе', 'Что зависло'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вымышленное выполненное дело недели', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Срочные сроки', exact: true })
      .getByRole('link', { name: /^Вымышленное ожидание проверки/ }),
  ).toHaveCount(1);
  await check(page, info, 'summary-weekly');
});
test('смена A → B во время ответа действия очищает личную причину и фильтры', async ({
  page,
  family,
}) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Личный срок участника A' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  await selectRadarState(page, 'all');
  await page.getByRole('button', { name: /^Ещё действия:/ }).click();
  await page.getByRole('button', { name: 'Не актуально', exact: true }).click();
  await page.getByLabel('Причина', { exact: true }).fill('Личная причина A');
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let started: () => void = () => {};
  const ready = new Promise<void>((r) => {
    started = r;
  });
  await page.route('**/api/deadlines/occurrences/*/action', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await ready;
  const other = await page.context().newPage();
  // Меняем общую cookie настоящим входом, без второго AuthRoot и его фоновой смены identity.
  // Вне scope service worker: он не подменит служебный HTML второй копией приложения.
  const sessionURL = new URL('/e2e-session.html', family.baseURL).href;
  await other.route(sessionURL, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="ru"><title>Смена участника</title></html>',
    }),
  );
  await other.goto(sessionURL);
  await expect(other.locator('script')).toHaveCount(0);
  const child = family.person('child');
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
      child,
    ),
  ).toBe(200);
  const defaultRadar = (response: Response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/deadlines' &&
      url.searchParams.get('offline') === 'true' &&
      !url.searchParams.has('state')
    );
  };
  async function expectRadarB(response: Response) {
    expect(response.status()).toBe(200);
    const snapshot = OfflineSnapshot.parse(await response.json());
    expect(snapshot.accountId).toBe(child.id);
    expect(RadarResponse.parse(snapshot.data).items).toEqual([]);
  }
  const radarB = page.waitForResponse(defaultRadar);
  // Отменённый focus-refetch может потерять CDP body: сохраняем настоящий ответ сервера.
  let receivedMe!: (response: APIResponse) => void;
  const updated = new Promise<APIResponse>((resolve) => {
    receivedMe = resolve;
  });
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response });
    receivedMe(response);
  });
  await page.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  const meB = await updated;
  expect(meB.status()).toBe(200);
  expect((await meB.json()).id).toBe(child.id);
  await expectRadarB(await radarB);
  await expect(page.getByLabel('Причина', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ещё фильтры', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Состояние', exact: true })).toHaveValue(
    'active',
  );
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  // Старый ответ A доставляем уже после загрузки радара B и ждём вызванного им обновления.
  const afterAction = page.waitForResponse(defaultRadar);
  release();
  await expectRadarB(await afterAction);
  await other.close();
  await expect(page).toHaveURL(/#\/more\/radar$/);
  await expect(page.getByText('Личный срок участника A', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Личная причина A', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ещё фильтры', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Состояние', exact: true })).toHaveValue(
    'active',
  );
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
});
