import type { Page } from '@playwright/test';
import { scheduleSummaries } from '../../../server/src/notifications/summaries.ts';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { apiAs, expectNothingStored, seedNote, seedObject } from './notes-support.ts';
import { expect, signInAs } from './support.ts';

// Push в сервис-воркере (R0.7b, NOTIF-1, NOTIF-6): настоящее событие `push`, которое браузер доставляет
// через протокол отладки, и настоящее `notificationclick`. Показ уведомлений есть только в полном Chromium:
// облегчённый безголовый запрет на уведомления не снимает, поэтому файл идёт на `channel: 'chromium'`.

test.use({ channel: 'chromium', permissions: ['notifications'] });
test('сводка: настоящее событие push и notificationclick до входа открывают защищённый API после входа', async ({
  page,
  family,
}) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Вымышленный срок из сводки' });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(-1) });
  await recalc(family);
  await scheduleSummaries(family.database.worker, new Date(Date.now() + 86400000));
  const rows = (await api.get('summaries')).body as { id: string; kind: string }[];
  const summary = rows.find((s) => s.kind === 'morning');
  if (!summary) throw new Error('Missing summary');
  await page.goto('#/sign-in');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  const { push, shown, click } = await connectWorker(page, family.origin);
  await push(
    JSON.stringify({ kind: 'summary', recordId: summary.id, text: 'В HomeCRM есть новое' }),
  );
  await expect.poll(async () => (await shown()).length).toBe(1);
  await click(`summary-${summary.id}`);
  await page.getByLabel('Имя пользователя или почта').fill('adult');
  await page.getByLabel('Пароль', { exact: true }).fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/more/summaries/${summary.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Сводки', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Вымышленный срок из сводки/ })).toBeVisible();
  await expectNothingStored(page, ['Вымышленный срок из сводки']);
});

test('дело: тестовый push и нажатие до входа открывают карточку после входа', async ({
  page,
  family,
}) => {
  const api = await apiAs(family, 'adult');
  const response = await api.post('tasks', { title: 'Дело из уведомления' });
  expect(response.status).toBe(201);
  const id = (response.body as { id: string }).id;
  await page.goto('#/sign-in');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  const { push, shown, click } = await connectWorker(page, family.origin);
  await push(JSON.stringify({ kind: 'deadline', recordId: id }));
  await expect.poll(async () => (await shown()).length).toBe(1);
  await click(`deadline-${id}`);
  await page.getByLabel('Имя пользователя или почта').fill('adult');
  await page.getByLabel('Пароль', { exact: true }).fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Дело из уведомления', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/today/tasks/${id}$`));
  await expectNothingStored(page, ['Дело из уведомления']);
});

/** Сервис-воркер страницы и протокол отладки: доставка push, показанные уведомления, нажатие на них. */
async function connectWorker(page: Page, origin: string, includeIcon = false) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  const registrations: { registrationId: string; isDeleted: boolean }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
    registrations.push(...event.registrations);
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrations.some((item) => !item.isDeleted)).toBe(true);
  const registrationId = registrations.find((item) => !item.isDeleted)?.registrationId ?? '';
  await expect
    .poll(() =>
      page
        .context()
        .serviceWorkers()
        .some((item) => item.url().endsWith('sw.js')),
    )
    .toBe(true);
  const worker = page
    .context()
    .serviceWorkers()
    .find((item) => item.url().endsWith('sw.js'));
  if (!worker) throw new Error('Service worker is not visible to the test');
  return {
    worker,
    push: async (data: string) => {
      // CDP подтверждает постановку доставки, а не завершение native showNotification.
      // Наблюдаем waitUntil только следующего настоящего push с теми же данными.
      const completion = await worker.evaluateHandle<{
        done: Promise<Promise<unknown>[]>;
        cleanup: () => void;
      }>(`(() => {
        const data = ${JSON.stringify(data)};
        const pending = [];
        const nativeWaitUntil = ExtendableEvent.prototype.waitUntil;
        let dispatched;
        const done = new Promise(resolve => { dispatched = resolve; });
        const matches = event => event.type === 'push' && event.isTrusted &&
          (event.data?.text() ?? '') === data;
        const observeWaitUntil = function (promise) {
          nativeWaitUntil.call(this, promise);
          if (matches(this)) pending.push(promise);
        };
        const onPush = event => {
          if (!matches(event)) return;
          cleanup();
          dispatched(pending);
        };
        const cleanup = () => {
          ExtendableEvent.prototype.waitUntil = nativeWaitUntil;
          self.removeEventListener('push', onPush);
        };
        ExtendableEvent.prototype.waitUntil = observeWaitUntil;
        self.addEventListener('push', onPush);
        return { done, cleanup };
      })()`);
      try {
        await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data });
        await completion.evaluate(async ({ done }) => {
          const pending = await done;
          if (pending.length === 0) throw new Error('Push did not extend its lifetime');
          await Promise.all(pending);
        });
      } finally {
        await completion.evaluate(({ cleanup }) => cleanup());
        await completion.dispose();
      }
    },
    shown: () =>
      page.evaluate(async (withIcon) => {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.getNotifications()).map((item) => ({
          title: item.title,
          body: item.body,
          tag: item.tag,
          data: item.data as unknown,
          ...(withIcon ? { icon: new URL(item.icon).pathname.split('/').pop() } : {}),
        }));
      }, includeIcon),
    click: (tag: string) =>
      worker.evaluate(`(async () => {
        const [item] = await self.registration.getNotifications({ tag: ${JSON.stringify(tag)} });
        self.dispatchEvent(new NotificationEvent('notificationclick', { notification: item }));
      })()`),
  };
}

test('сервис-воркер: push показывает уведомление, нажатие открывает запись', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await signInAs(page, family, 'adult');
  const { worker, push, shown } = await connectWorker(page, family.origin, true);

  // Содержимое от сервера: тег по записи, заголовок «HomeCRM», значок приложения.
  const message = { kind: 'deadline', recordId: flat.id, text: 'Подходит срок записи в HomeCRM' };
  await push(JSON.stringify(message));
  await expect.poll(shown).toEqual([
    {
      title: 'HomeCRM',
      body: 'Подходит срок записи в HomeCRM',
      tag: `deadline-${flat.id}`,
      data: { recordId: flat.id },
      icon: 'icon-192.png',
    },
  ]);

  // Повторный push о той же записи заменяет уведомление, а не копит одинаковые.
  await push(JSON.stringify({ ...message, text: 'В HomeCRM есть новое' }));
  await expect
    .poll(async () => (await shown()).map((item) => item.body))
    .toEqual(['В HomeCRM есть новое']);

  // Пустой и неразборчивый push всё равно показывают уведомление с запасным текстом.
  await push('');
  await push('{"сломано');
  await expect.poll(async () => (await shown()).length).toBe(2);
  const bodies = (await shown()).map((item) => item.body).sort();
  expect(bodies).toContain('В HomeCRM есть новое');

  // Содержимое push не попадает в кэш и хранилища страницы.
  await push(JSON.stringify({ kind: 'deadline', text: 'Проверочный текст push' }));
  await expect
    .poll(async () => (await shown()).some((item) => item.body === 'Проверочный текст push'))
    .toBe(true);
  await expectNothingStored(page, ['Проверочный текст push']);

  // Нажатие: окно получает маршрут, запись открывается, уведомление закрывается.
  await page.goto('#/today');
  await worker.evaluate(`(async () => {
    const [item] = await self.registration.getNotifications({ tag: ${JSON.stringify(`deadline-${flat.id}`)} });
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: item }));
  })()`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain('#/home/');
  await expect
    .poll(async () => (await shown()).some((item) => item.tag === `deadline-${flat.id}`))
    .toBe(false);

  // Коммунальный вид (ADR-0033): нажатие ведёт на экран показаний этого объекта.
  await push(
    JSON.stringify({ kind: 'deadline', recordId: flat.id, notificationKind: 'readings_open' }),
  );
  const utilityTag = `deadline-readings_open-${flat.id}`;
  await expect.poll(async () => (await shown()).some((item) => item.tag === utilityTag)).toBe(true);
  await page.goto('#/today');
  await worker.evaluate(`(async () => {
    const [item] = await self.registration.getNotifications({ tag: ${JSON.stringify(utilityTag)} });
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: item }));
  })()`);
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}/readings$`));

  // Запись, которой уже нет, не ломает переход: понятное сообщение и дорога в радар.
  const gone = '0b8f6d3e-5c1a-4f7e-9d21-3a6b8c4e7f10';
  await push(JSON.stringify({ kind: 'deadline', recordId: gone, text: 'В HomeCRM есть новое' }));
  await expect
    .poll(async () => (await shown()).some((item) => item.tag === `deadline-${gone}`))
    .toBe(true);
  await worker.evaluate(`(async () => {
    const [item] = await self.registration.getNotifications({ tag: ${JSON.stringify(`deadline-${gone}`)} });
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: item }));
  })()`);
  await expect(page.getByText('Записи больше нет, или она стала вам недоступна.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть радар сроков' })).toBeVisible();
});

test('режим «скрывать текст» и тишина консоли: ни текста, ни названий записи в уведомлении и журнале', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await signInAs(page, family, 'adult');
  const logged: string[] = [];
  page.on('console', (message) => logged.push(message.text()));
  const { worker, push, shown } = await connectWorker(page, family.origin);
  worker.on('console', (message) => logged.push(message.text()));

  // Сервер при скрытии текста шлёт только вид и запись (NOTIF-6): уведомление общее, без названия.
  await push(JSON.stringify({ kind: 'deadline', recordId: flat.id }));
  await expect.poll(async () => (await shown()).length).toBe(1);
  const [hidden] = await shown();
  expect(hidden).toEqual({
    title: 'HomeCRM',
    body: 'В HomeCRM есть новое',
    tag: `deadline-${flat.id}`,
    data: { recordId: flat.id },
  });
  expect(JSON.stringify(hidden)).not.toContain('Квартира у парка');

  // Текст приходит, только если участник отключил скрытие; воркер показывает его как есть.
  await push(JSON.stringify({ kind: 'deadline', text: 'Подходит срок: Квартира у парка' }));
  await expect.poll(async () => (await shown()).length).toBe(2);
  expect((await shown()).map((item) => item.body)).toContain('Подходит срок: Квартира у парка');

  // Пустой и неразборчивый push, нажатие и новая подписка: воркер ничего не пишет в консоль.
  await push('');
  await push('{"сломано');
  await worker.evaluate(`self.dispatchEvent(new ExtendableEvent('pushsubscriptionchange'))`);
  await page.waitForTimeout(500);
  expect(worker.url()).toContain('sw.js');
  expect(logged, 'консоль страницы и воркера').toEqual([]);
});

test('сессии нет: смена подписки в службе push не создаёт подписку', async ({ page, family }) => {
  await page.goto('#/sign-in');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  const { worker } = await connectWorker(page, family.origin);
  const paths: string[] = [];
  page.context().on('request', (request) => paths.push(new URL(request.url()).pathname));

  await worker.evaluate(`self.dispatchEvent(new ExtendableEvent('pushsubscriptionchange'))`);
  await expect.poll(() => paths.includes('/api/auth/get-session')).toBe(true);
  await page.waitForTimeout(500);
  // Ни ключа сервера, ни записи подписки: без входа сервер её не примет.
  expect(paths.filter((path) => path.startsWith('/api/push'))).toEqual([]);
});

test('нажатие на уведомление на экране входа: запись открывается после входа', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await page.goto('#/sign-in');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  const { push, shown, click } = await connectWorker(page, family.origin);
  await push(JSON.stringify({ kind: 'deadline', recordId: flat.id }));
  await expect.poll(async () => (await shown()).length).toBe(1);
  await click(`deadline-${flat.id}`);
  await expect.poll(async () => (await shown()).length).toBe(0);

  // Экран входа остался на месте, а переход ждёт: после входа открывается запись, а не «Сегодня».
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await page.getByLabel('Имя пользователя или почта').fill('adult');
  await page.getByLabel('Пароль', { exact: true }).fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain('#/home/');
});

test('окно открыто по уведомлению до входа: адрес записи сохраняется и открывается после входа', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const flat = await seedObject(boris, family, { title: 'Квартира у парка', audience: 'adults' });
  await page.goto(`#/open/${flat.id}`);
  await page.getByLabel('Имя пользователя или почта').fill('adult');
  await page.getByLabel('Пароль', { exact: true }).fill(family.person('adult').password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain('#/home/');
});
