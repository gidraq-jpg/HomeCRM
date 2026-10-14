import type { Page, Route } from '@playwright/test';
import { TaskCard } from '../../src/tasks/api.ts';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

async function drafts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, bad) => {
      const request = indexedDB.open('homecrm-offline');
      request.onsuccess = () => ok(request.result);
      request.onerror = () => bad(request.error);
    });
    try {
      return await new Promise<{ data: { base: { updatedAt: string } | null } }[]>((ok, bad) => {
        const request = db.transaction('drafts').objectStore('drafts').getAll();
        request.onsuccess = () => ok(request.result);
        request.onerror = () => bad(request.error);
      });
    } finally {
      db.close();
    }
  });
}

type AutosaveGate = { held: boolean; release: () => void; restore: () => void };
type GateWindow = Window & { homecrmAutosaveGate?: AutosaveGate };

/** Задерживается настоящий requestTicket autosave; данные и базовая версия не подменяются. */
async function holdAutosave(page: Page) {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    const armedAt = performance.now();
    let armed = true;
    const state: AutosaveGate = {
      held: false,
      release: () => {},
      restore: () => {
        IDBObjectStore.prototype.get = original;
      },
    };
    (window as GateWindow).homecrmAutosaveGate = state;
    IDBObjectStore.prototype.get = function (key) {
      const request = original.call(this, key);
      if (
        !armed ||
        this.name !== 'identity' ||
        key !== 'active' ||
        performance.now() - armedAt < 290
      )
        return request;
      armed = false;
      return new Proxy(request, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
          if (property === 'onsuccess') {
            target.onsuccess = (event) => {
              state.held = true;
              state.release = () => {
                state.release = () => {};
                state.restore();
                value.call(target, event);
              };
            };
            return true;
          }
          return Reflect.set(target, property, value, target);
        },
      });
    };
  });
  await page.clock.runFor(310);
  await expect
    .poll(() => page.evaluate(() => (window as GateWindow).homecrmAutosaveGate?.held))
    .toBe(true);
}

test('TASK-5: быстрый Edit после PATCH получает точный snapshot и сохраняет настоящий 409', async ({
  page,
  family,
  context,
}, info) => {
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Дело с точной версией',
    checklist: [{ id: crypto.randomUUID(), title: 'Первый пункт', done: false, position: 0 }],
  });
  expect(created.status).toBe(201);
  const row = TaskCard.parse(created.body);
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title, exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
  let release!: () => void;
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  let held = false;
  let first = true;
  const inFlight = new Set<Promise<void>>();
  const handler = (route: Route) => {
    const shouldHold = first;
    first = false;
    const invocation = (async () => {
      const response = await route.fetch();
      if (shouldHold) {
        held = true;
        await gate;
      }
      // Первый GET отменяется при Edit, но его route всё равно нужно завершить.
      await route.fulfill({ response }).catch(() => {});
    })();
    inFlight.add(invocation);
    void invocation.then(
      () => inFlight.delete(invocation),
      () => inFlight.delete(invocation),
    );
    return invocation;
  };
  await context.route(`**/api/tasks/${row.id}?*`, handler);
  try {
    const toggle = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith(`/api/tasks/${row.id}`),
    );
    await page.getByRole('checkbox', { name: 'Первый пункт' }).click();
    const acknowledgment = await toggle;
    expect(acknowledgment.status()).toBe(200);
    const dto = await acknowledgment.json();
    const version = dto.receipt.results.find(
      (result: { id: string }) => result.id === row.id,
    ).updatedAt;
    expect(dto.updatedAt).not.toBe(version);
    await expect(page.getByRole('checkbox', { name: 'Первый пункт' })).toBeEnabled();
    await page.clock.runFor(10);
    await expect.poll(() => held).toBe(true);
    await page.getByRole('button', { name: 'Править дело' }).click();
    await page.getByLabel('Пункт 1', { exact: true }).fill('Мой черновик');
    // Save происходит до debounce: точная база обязана прийти из coherent GET.
    expect(await drafts(page)).toHaveLength(0);
    const latest = TaskCard.parse((await api.get(`tasks/${row.id}`)).body);
    expect(
      (
        await api.patch(`tasks/${row.id}`, {
          checklist: latest.checklist.map((item) => ({ ...item, title: 'Чужая версия' })),
          expectedUpdatedAt: latest.updatedAt,
        })
      ).status,
    ).toBe(200);
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith(`/api/tasks/${row.id}`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await conflict;
    expect(response.request().postDataJSON().expectedUpdatedAt).toBe(version);
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe('STALE_VERSION');
    await expect(page.getByRole('alert')).toContainText('Дело изменили на другом устройстве');
    await expect(page.getByLabel('Пункт 1', { exact: true })).toHaveValue('Мой черновик');
    expect(TaskCard.parse((await api.get(`tasks/${row.id}`)).body).checklist[0]?.title).toBe(
      'Чужая версия',
    );
  } finally {
    release();
    await page.clock.resume();
    await Promise.allSettled([...inFlight]);
    await context.unroute(`**/api/tasks/${row.id}?*`, handler);
  }
  await checkApp(page, info, 'task-edit-exact-conflict');
});

test('TASK-5: autosave после clearDraft и unmount не воскрешает базу; following использует текущую', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const created = await api.post('tasks', {
    title: 'Серия без позднего черновика',
    planOn: homeDate(0),
    repeatRule: { kind: 'daily' },
  });
  expect(created.status).toBe(201);
  const row = TaskCard.parse(created.body);
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title, exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
  try {
    await page.getByRole('button', { name: 'Править дело' }).click();
    await page.getByLabel('Название дела').fill('Первое успешное изменение');
    await holdAutosave(page);
    const firstAck = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith(`/api/tasks/${row.id}`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await firstAck;
    expect(response.status()).toBe(200);
    const receipt = (await response.json()).receipt;
    const version = receipt.results.find(
      (result: { id: string }) => result.id === row.id,
    ).updatedAt;
    await expect(page.locator('form.task-form')).toHaveCount(0);
    expect(await drafts(page)).toHaveLength(0);
    await page.evaluate(() => (window as GateWindow).homecrmAutosaveGate?.release());
    await page.clock.runFor(10);
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect(page.getByLabel('Название дела')).toHaveValue('Первое успешное изменение');
    expect(await drafts(page)).toHaveLength(0);
    await page.getByLabel('Область правки серии').selectOption('following');
    await page.getByLabel('Название дела').fill('Все следующие без старой базы');
    const secondAck = page.waitForResponse(
      (ack) =>
        ack.request().method() === 'PATCH' &&
        ack.url().endsWith(`/api/tasks/${row.id}`) &&
        ack.request().postDataJSON()?.repeatScope === 'following',
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const following = await secondAck;
    expect(following.request().postDataJSON().expectedUpdatedAt).toBe(version);
    expect(following.status()).toBe(200);
    await expect(page.locator('form.task-form')).toHaveCount(0);
    await page.clock.runFor(10);
    expect(TaskCard.parse((await api.get(`tasks/${row.id}`)).body).title).toBe(
      'Все следующие без старой базы',
    );
  } finally {
    await page.evaluate(() => {
      const gate = (window as GateWindow).homecrmAutosaveGate;
      gate?.release();
      gate?.restore();
    });
    await page.clock.resume();
  }
  await checkApp(page, info, 'task-edit-following-current');
});

test('TASK-5: Edit читает офлайн-snapshot, показывает отсутствие снимка и позволяет повторить', async ({
  page,
  family,
  context,
}) => {
  const api = await apiAs(family, 'adult');
  const row = TaskCard.parse((await api.post('tasks', { title: 'Сохранённое дело' })).body);
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title, exact: true })).toBeVisible();
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect(page.getByLabel('Название дела')).toHaveValue(row.title);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.evaluate(async (path) => {
      const db = await new Promise<IDBDatabase>((ok, bad) => {
        const request = indexedDB.open('homecrm-offline');
        request.onsuccess = () => ok(request.result);
        request.onerror = () => bad(request.error);
      });
      try {
        await new Promise<void>((ok, bad) => {
          const tx = db.transaction('snapshots', 'readwrite');
          const store = tx.objectStore('snapshots');
          const request = store.getAll();
          request.onsuccess = () => {
            for (const snapshot of request.result)
              if (snapshot.path === path) store.delete(snapshot.key);
          };
          tx.oncomplete = () => ok();
          tx.onerror = () => bad(tx.error);
        });
      } finally {
        db.close();
      }
    }, `tasks/${row.id}`);
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Эти данные ещё не сохранены на устройстве' }),
    ).toBeVisible();
    await expect(page.locator('form.task-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Править дело' })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole('button', { name: 'Править дело' }).click();
  await expect(page.getByLabel('Название дела')).toHaveValue(row.title);
});

test('TASK-5: Edit не заменяет HTTP 403/404 кэшем и отменяет поздний результат после перехода', async ({
  page,
  family,
  context,
}) => {
  const api = await apiAs(family, 'adult');
  const row = TaskCard.parse((await api.post('tasks', { title: 'Дело для проверки отказа' })).body);
  const other = TaskCard.parse((await api.post('tasks', { title: 'Другая карточка' })).body);
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title, exact: true })).toBeVisible();
  const pattern = `**/api/tasks/${row.id}?*`;
  for (const status of [404, 403]) {
    const reject = (route: Route) => route.fulfill({ status, json: { code: 'FORBIDDEN' } });
    await context.route(pattern, reject);
    try {
      await page.getByRole('button', { name: 'Править дело' }).click();
      await expect(page.getByRole('alert')).toContainText(
        status === 404 ? 'Дело недоступно' : 'Это действие недоступно',
      );
      await expect(page.locator('form.task-form')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Править дело' })).toBeEnabled();
    } finally {
      await context.unroute(pattern, reject);
    }
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect(page.getByLabel('Название дела')).toHaveValue(row.title);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  }
  let release!: () => void;
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  let held = false;
  let completion: Promise<void> | undefined;
  const delay = (route: Route) => {
    completion = (async () => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response }).catch(() => {});
    })();
    return completion;
  };
  await context.route(pattern, delay);
  try {
    await page.getByRole('button', { name: 'Править дело' }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.locator('form.task-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Править дело' })).toBeDisabled();
    await page.goto(`#/today/tasks/${other.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: other.title, exact: true }),
    ).toBeVisible();
    release();
    await completion;
    await expect(page.locator('form.task-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Править дело' })).toBeEnabled();
  } finally {
    release();
    await completion;
    await context.unroute(pattern, delay);
  }
});

test('TASK-5: ошибка autosave активной формы видна, следующий ввод сохраняется', async ({
  page,
  family,
}) => {
  const api = await apiAs(family, 'adult');
  const row = TaskCard.parse(
    (await api.post('tasks', { title: 'Ошибка хранения черновика' })).body,
  );
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${row.id}`);
  await expect(page.getByRole('heading', { level: 1, name: row.title, exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
  await page.getByRole('button', { name: 'Править дело' }).click();
  await page.getByLabel('Название дела').fill('Ввод остаётся при quota');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'drafts') throw new DOMException('Test quota', 'QuotaExceededError');
      return original.call(this, value, key);
    };
    window.addEventListener(
      'homecrm-test-restore-put',
      () => {
        IDBObjectStore.prototype.put = original;
      },
      { once: true },
    );
  });
  try {
    await page.clock.runFor(310);
    await expect(page.getByRole('alert').filter({ hasText: 'Черновик не сохранён' })).toBeVisible();
    await expect(page.getByLabel('Название дела')).toHaveValue('Ввод остаётся при quota');
    expect(await drafts(page)).toHaveLength(0);
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event('homecrm-test-restore-put')));
    await page.clock.resume();
  }
  await page.getByLabel('Название дела').fill('Повторный ввод после ошибки');
  await expect
    .poll(async () => JSON.stringify(await drafts(page)))
    .toContain('Повторный ввод после ошибки');
  await expect(page.getByRole('alert').filter({ hasText: 'Черновик не сохранён' })).toHaveCount(0);
});
