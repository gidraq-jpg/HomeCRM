import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAuthDatabase } from '@homecrm/db';
import type { Page, TestInfo } from '@playwright/test';
import { createHousehold } from '../../../server/src/auth/provision.ts';
import { Me } from '../../src/auth/api.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  SCREENSHOT_DIR,
  screenshot,
  widthOf,
} from '../support/helpers.ts';
import { makePng } from './files-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) =>
    process.stdout.write(`Browser failure: ${error.name} ${error.message}\n`),
  );
});
type Row = {
  id: string;
  state: string;
  createdAt: number;
  operation: string;
  body: Record<string, unknown>;
  dependencies: string[];
  attempted: boolean;
  receipt?: {
    results: { id: string; updatedAt: string }[];
    parent?: { id: string; updatedAt: string };
  };
  frozenBody?: string;
  frozenPath?: string;
  nextAttempt: number;
};
async function rows(page: Page, table = 'outbox'): Promise<Row[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((ok, bad) => {
      const r = indexedDB.open('homecrm-offline');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(r.error);
    });
    try {
      return await new Promise<Row[]>((ok, bad) => {
        const t = db.transaction(name);
        const r = t.objectStore(name).getAll();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
    } finally {
      db.close();
    }
  }, table);
}
async function updateRow(
  page: Page,
  id: string,
  change: Record<string, unknown>,
  table = 'outbox',
) {
  await page.evaluate(
    async ({ id, change, table }) => {
      const db = await new Promise<IDBDatabase>((ok, bad) => {
        const r = indexedDB.open('homecrm-offline');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
      await new Promise<void>((ok, bad) => {
        const tx = db.transaction(table, 'readwrite');
        const store = tx.objectStore(table);
        const r = store.get(id);
        r.onsuccess = () => {
          if (r.result) store.put({ ...r.result, ...change });
        };
        tx.oncomplete = () => ok();
        tx.onerror = () => bad(tx.error);
      });
      db.close();
    },
    { id, change, table },
  );
}
async function shell(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((ok) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true }),
      );
  });
}
async function queue(page: Page) {
  await page.goto('#/more/offline');
  await expect(page.getByRole('heading', { level: 1, name: 'Очередь изменений' })).toBeVisible();
}
async function sync(page: Page) {
  await queue(page);
  await page.getByRole('button', { name: 'Синхронизировать', exact: true }).click();
}
async function check(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, name);
  if (process.platform === 'linux') {
    const dir = resolve(
      import.meta.dirname,
      '../../../../docs/screenshots/R1c.7-8',
      info.project.name,
    );
    await mkdir(dir, { recursive: true });
    await screenshot(page, info, name, 'viewport');
    await copyFile(
      resolve(SCREENSHOT_DIR, String(widthOf(info)), `${name}.png`),
      resolve(dir, `${name}.png`),
    );
  }
}
async function newNote(page: Page, title: string) {
  await page.goto('#/more/notes/new');
  await page.getByLabel('Заголовок', { exact: true }).fill(title);
  await page.getByLabel('Текст', { exact: true }).fill('Локальный текст вымышленной семьи');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
}
test('SHOP: прототип списка, real quickline/bought/undo/trash/restore/search и ребёнок', async ({
  page,
  family,
  browser,
}, info) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await api.post('shopping', {
    title: 'Личный рюкзак',
    quantity: '1',
    data: { note: 'Для похода', store: 'Спорт', category: 'Одежда' },
  });
  const shared = await api.post('shopping', {
    title: 'Семейное молоко',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const id = (shared.body as { id: string }).id;
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto('#/more/shopping');
  await expect(page.getByRole('link', { name: /Личный рюкзак/ })).toBeVisible();
  await check(page, info, 'shopping-real');
  await page.getByLabel('Добавить одной строкой').fill('Хлеб вымышленной семьи');
  await page.getByRole('button', { name: 'Добавить покупку', exact: true }).click();
  await expect(page.getByRole('link', { name: /Хлеб вымышленной семьи/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Семейное молоко' }).click();
  await expect(page.getByText('Куплено · 1')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Семейное молоко' })).not.toBeChecked();
  await page.goto(`#/more/shopping/${id}`);
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByRole('button', { name: 'Корзина покупок' }).click();
  await page.getByRole('link', { name: /Семейное молоко/ }).click();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.getByRole('button', { name: 'Куплено', exact: true })).toBeVisible();
  const search = await api.get('search?q=молоко&includeShopping=true');
  expect(JSON.stringify(search.body)).toContain('shopping_item');
  const context = await browser.newContext({ baseURL: family.baseURL });
  const child = await context.newPage();
  await signInAs(child, family, 'child');
  await child.goto('#/more/shopping');
  await expect(child.getByRole('link', { name: /Личный рюкзак/ })).toHaveCount(0);
  await child.getByLabel('Добавить одной строкой').fill('Сок от ребёнка');
  await child.getByRole('button', { name: 'Добавить покупку', exact: true }).click();
  await expect(child.getByRole('link', { name: /Сок от ребёнка/ })).toBeVisible();
  await context.close();
});
test('OFFLINE: reload → durable note → reload → create/edit chain → один эффект', async ({
  page,
  family,
  context,
}, info) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto('#/more/notes');
  await page.goto('#/more/radar');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Радар' })).toBeVisible();
  await newNote(page, 'Офлайн заметка');
  await expect(page.getByText(/Сохранено на устройстве/).first()).toBeVisible();
  await page.reload();
  await queue(page);
  await expect(page.getByRole('heading', { level: 3, name: 'Офлайн заметка' })).toBeVisible();
  await page.getByRole('button', { name: 'Править локальный ввод' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Офлайн заметка изменена');
  await page.getByRole('button', { name: 'Сохранить зависимую правку' }).click();
  await check(page, info, 'offline-queue');
  expect((await rows(page)).filter((row) => row.state !== 'confirmed')).toHaveLength(2);
  await page.reload();
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const notes = await api.get('notes?scope=personal');
  const list = notes.body as { title: string }[];
  expect(list.filter((note) => note.title === 'Офлайн заметка изменена')).toHaveLength(1);
});
test('OFFLINE: task create/edit/complete, отмена неотправленного done и 7 секунд online', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await page.goto('#/today/new');
  await page.getByLabel('Название дела', { exact: true }).fill('Офлайн дело');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await queue(page);
  await page.getByRole('button', { name: 'Править локальный ввод' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Офлайн дело изменено');
  await page.getByRole('button', { name: 'Сохранить зависимую правку' }).click();
  await page.getByRole('button', { name: 'Выполнить после создания' }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(3);
  const pending = await rows(page);
  expect(pending).toHaveLength(3);
  const done = pending.find((row) => row.operation === 'task_status');
  expect(done?.attempted).toBe(false);
  const doneArticle = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Выполнение дела' }) });
  await doneArticle.getByRole('button', { name: 'Отменить намерение' }).click();
  expect((await rows(page)).some((row) => row.operation === 'task_status')).toBe(false);
  await page.getByRole('button', { name: 'Выполнить после создания' }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(3);
  await page.reload();
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const tasks = (await api.get('tasks?scope=personal')).body as {
    id: string;
    title: string;
    status: string;
  }[];
  expect(tasks.filter((task) => task.title === 'Офлайн дело изменено')).toHaveLength(1);
  expect(tasks.find((task) => task.title === 'Офлайн дело изменено')?.status).toBe('done');
  const online = (await api.post('tasks', { title: 'Для отмены' })).body as { id: string };
  await page.goto(`#/today/tasks/${online.id}`);
  await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
  await expect(page.getByRole('button', { name: /Отменить выполнение/ })).toBeVisible();
  await page.getByRole('button', { name: /Отменить выполнение/ }).click();
  await expect
    .poll(async () => ((await api.get(`tasks/${online.id}`)).body as { status: string }).status)
    .toBe('open');
});
test('OFFLINE: COMMIT с потерянным ACK, две вкладки и immutable replay', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  let dropped = false;
  await context.route('**/api/notes', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await newNote(page, 'Потерянный ACK');
  await expect
    .poll(async () => (await rows(page)).some((row) => row.state === 'unknown'))
    .toBe(true);
  const before = (await rows(page))[0];
  expect(before?.frozenBody).toBeTruthy();
  const second = await context.newPage();
  await second.goto('#/more/offline');
  await expect(second.getByRole('heading', { level: 1, name: 'Очередь изменений' })).toBeVisible();
  await context.unroute('**/api/notes');
  if (before) await updateRow(page, before.id, { nextAttempt: 0 });
  await Promise.all([sync(page), sync(second)]);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const after = (await rows(page))[0];
  expect(after?.id).toBe(before?.id);
  expect(after?.frozenBody).toBe(before?.frozenBody);
  const notes = (await api.get('notes?scope=personal')).body as { title: string }[];
  expect(notes.filter((note) => note.title === 'Потерянный ACK')).toHaveLength(1);
  await second.close();
});
test('OFFLINE: 409 сохраняет ввод, независимая запись проходит и решение даёт новый ключ', async ({
  page,
  family,
  context,
}, info) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, { title: 'Исходная версия', body: 'Первый текст' });
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto(`#/more/notes/${note.id}`);
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await context.setOffline(true);
  await page.getByLabel('Текст', { exact: true }).fill('Мой локальный текст');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await newNote(page, 'Независимая заметка');
  await api.patch(`notes/${note.id}`, { body: 'Чужой серверный текст' });
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).filter((row) => row.state === 'confirmed').length)
    .toBe(1);
  const conflict = (await rows(page)).find((row) => row.state === 'conflict');
  expect(conflict).toBeTruthy();
  await check(page, info, 'offline-conflict');
  await page.getByRole('button', { name: 'Сравнить и решить' }).click();
  await expect(page.getByText(/Чужой серверный текст/)).toBeVisible();
  await page.getByRole('button', { name: 'Применить мою правку' }).click();
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const next = (await rows(page)).find((row) => row.operation === 'note_patch');
  expect(next?.id).not.toBe(conflict?.id);
  expect(((await api.get(`notes/${note.id}`)).body as { body: string }).body).toBe(
    'Мой локальный текст',
  );
});
test('OFFLINE: настоящие два фото, lost ACK multipart, batch и точный receipt.parent', async ({
  page,
  family,
  context,
}, info) => {
  test.setTimeout(150000);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, { title: 'Вымышленная квартира' });
  const meter = await seedMeter(api, object.id, {
    title: 'Холодная вода',
    data: { resource: 'cold_water', serialNumber: 'TEST-101', zones: ['Вода'], status: 'active' },
    initial: { occurredOn: '2026-09-20', values: ['100'] },
  });
  await seedMeter(api, object.id, {
    title: 'Горячая вода',
    data: { resource: 'hot_water', serialNumber: 'TEST-102', zones: ['Вода'], status: 'active' },
    initial: { occurredOn: '2026-09-20', values: ['200'] },
  });
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto(`#/home/${object.id}/readings`);
  await expect(page.getByLabel(/Новое значение/).first()).toBeVisible();
  await context.setOffline(true);
  await page
    .getByLabel(/Новое значение/)
    .nth(0)
    .fill('110');
  await page
    .getByLabel(/Новое значение/)
    .nth(1)
    .fill('210');
  await page.getByLabel('Фото счётчика: Холодная вода').setInputFiles([
    { name: 'photo-one.png', mimeType: 'image/png', buffer: makePng(100, 100, true) },
    { name: 'photo-two.png', mimeType: 'image/png', buffer: makePng(120, 120, true) },
  ]);
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.getByText(/Сохранено на устройстве/).first()).toBeVisible();
  expect(await rows(page, 'blobs')).toHaveLength(2);
  await check(page, info, 'offline-reading');
  await page.reload();
  await queue(page);
  let lost = false;
  await context.route(`**/api/objects/${object.id}/files`, async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () =>
      (await rows(page)).some((row) => row.operation === 'file_upload' && row.state === 'unknown'),
    )
    .toBe(true);
  const photo = (await rows(page)).find(
    (row) => row.operation === 'file_upload' && row.state === 'unknown',
  );
  expect(await rows(page, 'blobs')).toHaveLength(2);
  await context.unroute(`**/api/objects/${object.id}/files`);
  if (photo) await updateRow(page, photo.id, { nextAttempt: 0 });
  let batchLost = false;
  await context.route(`**/api/objects/${object.id}/readings`, async (route) => {
    if (!batchLost) {
      batchLost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await sync(page);
  await expect
    .poll(async () =>
      (await rows(page)).some(
        (row) => row.operation === 'readings_create' && row.state === 'unknown',
      ),
    )
    .toBe(true);
  const batch = (await rows(page)).find((row) => row.operation === 'readings_create');
  expect(await rows(page, 'blobs')).toHaveLength(2);
  await page.reload();
  if (batch) await updateRow(page, batch.id, { nextAttempt: 0 });
  await context.unroute(`**/api/objects/${object.id}/readings`);
  await sync(page);

  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const all = await rows(page);
  expect(all.find((row) => row.operation === 'readings_create')?.id).toBe(batch?.id);
  expect(all.find((row) => row.operation === 'readings_create')?.frozenBody).toBe(
    batch?.frozenBody,
  );
  const uploads = all
    .filter((row) => row.operation === 'file_upload')
    .toSorted((a, b) => a.createdAt - b.createdAt);
  expect(JSON.parse(uploads[1]?.frozenBody ?? '{}').expectedUpdatedAt).toBe(
    uploads[0]?.receipt?.parent?.updatedAt,
  );
  expect(await rows(page, 'blobs')).toHaveLength(0);
  const readings = (await api.get(`meters/${meter.id}/readings`)).body as {
    photoIds: string[];
    values: string[];
  }[];
  expect(readings.filter((row) => Number(row.values[0]) === 110)).toHaveLength(1);
  expect(readings.find((row) => Number(row.values[0]) === 110)?.photoIds).toHaveLength(2);
});
test('OFFLINE: аккаунт A → B, отложенный snapshot с другой cookie не попадает в A', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await newNote(page, 'Личное намерение A');
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  await page.reload();
  await context.route('**/api/notes', (route) => route.abort('failed'));
  await context.setOffline(false);
  await expect
    .poll(async () => (await rows(page, 'identity'))[0])
    .toMatchObject({ verified: true });
  let release: () => void = () => {};
  const delayed = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/api/shopping?*', async (route) => {
    await delayed;
    await route.continue();
  });
  await page.goto('#/more/shopping');
  const response = await context.request.post(`${family.origin}/api/auth/sign-in/username`, {
    headers: { origin: family.origin },
    data: {
      username: 'child',
      password: family.person('child').password,
    },
  });
  expect(response.ok()).toBe(true);
  release();
  await expect
    .poll(async () => (await rows(page, 'identity'))[0])
    .toMatchObject({ owner: family.person('child').id });
  expect(await rows(page)).toHaveLength(0);
  expect(await rows(page, 'blobs')).toHaveLength(0);
  const notes = await (await apiAs(family, 'adult')).get('notes?scope=personal');
  expect(JSON.stringify(notes.body)).not.toContain('Личное намерение A');
});
test('OFFLINE: quota не выдаёт durable save и выбранный выход удаляет локальное', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'outbox') throw new DOMException('Test quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await newNote(page, 'Не сохранено из-за квоты');
  await expect(page.getByText(/недостаточно места/)).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
  await page.reload();
  await newNote(page, 'Сохранено перед выходом');
  await queue(page);
  expect(await rows(page)).toHaveLength(1);
  await context.route('**/api/notes', (route) => route.abort('failed'));
  await context.setOffline(false);
  await page.goto('#/more/settings');
  const refused = page.waitForEvent('dialog');
  await Promise.all([
    page.getByRole('button', { name: 'Выйти', exact: true }).click(),
    refused.then((dialog) => dialog.dismiss()),
  ]);
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeEnabled();
  expect(await rows(page)).toHaveLength(1);
  const accepted = page.waitForEvent('dialog');
  await Promise.all([
    page.getByRole('button', { name: 'Выйти', exact: true }).click(),
    accepted.then((dialog) => dialog.accept()),
  ]);
  await expect(page.getByRole('heading', { level: 1, name: 'Войти в HomeCRM' })).toBeVisible();
  expect(await rows(page)).toHaveLength(0);
});

test('OFFLINE: истёкшая сессия блокирует replay и тот же аккаунт сохраняет очередь', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await newNote(page, 'Очередь при истёкшей сессии');
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  const original = (await rows(page))[0];
  await context.clearCookies();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM', level: 1 })).toBeVisible();
  expect((await rows(page))[0]?.id).toBe(original?.id);
  expect(JSON.stringify((await api.get('notes?scope=personal')).body)).not.toContain(
    'Очередь при истёкшей сессии',
  );
  await signInAs(page, family, 'adult');
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  expect((await rows(page))[0]?.id).toBe(original?.id);
});
test('OFFLINE: удалённая заметка даёт отказ, независимая проходит и локальный текст остаётся', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Заметка до удаления',
    body: 'Изначальный текст',
  });
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto(`#/more/notes/${note.id}`);
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await context.setOffline(true);
  await page.getByLabel('Текст', { exact: true }).fill('Правка после удаления');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  await newNote(page, 'Независимое после удаления');
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  await api.post(`notes/${note.id}/trash`, {});
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () =>
      (await rows(page)).some((row) => row.operation === 'note_patch' && row.state === 'error'),
    )
    .toBe(true);
  expect((await rows(page)).find((row) => row.operation === 'note_patch')?.body.body).toBe(
    'Правка после удаления',
  );
  await expect
    .poll(async () =>
      (await rows(page)).some(
        (row) => row.operation === 'note_create' && row.state === 'confirmed',
      ),
    )
    .toBe(true);
});
test('OFFLINE: изменение роли сбрасывает доступные ранее снимки и сохраняет конфликтную очередь', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Только взрослые',
    body: 'Текст взрослой записи',
    audience: 'adults',
  });
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto(`#/more/notes/${note.id}`);
  await page.getByRole('button', { name: 'Править', exact: true }).click();
  await context.setOffline(true);
  await page.getByLabel('Текст', { exact: true }).fill('Локальный ввод взрослого');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  const id = (await rows(page))[0]?.id;
  await family.database.admin.query('UPDATE notes SET assignee_id=$2 WHERE id=$1', [
    note.id,
    family.person('admin').id,
  ]);
  await family.database.admin.query(
    "UPDATE space_members SET role='child' WHERE account_id=$1 AND space_id=$2",
    [family.person('adult').id, family.houseId],
  );
  await context.setOffline(false);
  await page.goto('#/more/offline');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Очередь изменений' })).toBeVisible();
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).some((row) => row.id === id && row.state === 'error'))
    .toBe(true);
  const snapshots = await rows(page, 'snapshots');
  expect(JSON.stringify(snapshots)).not.toContain('Текст взрослой записи');
  expect((await rows(page))[0]?.body.body).toBe('Локальный ввод взрослого');
});
test('OFFLINE: lease умершей вкладки восстанавливает прежний отправленный ключ', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  let lost = false;
  await context.route('**/api/notes', async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await newNote(page, 'После аварии вкладки');
  await expect
    .poll(async () => (await rows(page)).some((row) => row.state === 'unknown'))
    .toBe(true);
  const before = (await rows(page))[0];
  expect(before?.attempted).toBe(true);
  if (before) await updateRow(page, before.id, { state: 'sending', nextAttempt: 0 });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok) => {
      const request = indexedDB.open('homecrm-offline');
      request.onsuccess = () => ok(request.result);
    });
    await new Promise<void>((ok) => {
      const tx = db.transaction('leases', 'readwrite');
      tx.objectStore('leases').put({ id: 'sender', holder: 'dead-tab', expiresAt: Date.now() - 1 });
      tx.oncomplete = () => ok();
    });
    db.close();
  });
  await context.unroute('**/api/notes');
  await page.reload();
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const after = (await rows(page))[0];
  expect(after?.id).toBe(before?.id);
  expect(after?.frozenBody).toBe(before?.frozenBody);
  const notes = (await api.get('notes?scope=personal')).body as { title: string }[];
  expect(notes.filter((note) => note.title === 'После аварии вкладки')).toHaveLength(1);
});
test('OFFLINE: миграция Dexie1→2 сохраняет pending, Blob и исходный ключ', async ({
  family,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL: family.baseURL, serviceWorkers: 'block' });
  const login = await context.request.post(`${family.origin}/api/auth/sign-in/username`, {
    headers: { origin: family.origin },
    data: { username: 'adult', password: family.person('adult').password },
  });
  expect(login.ok()).toBe(true);
  const me = Me.parse((await (await apiAs(family, 'adult')).get('me')).body);
  const page = await context.newPage();
  await page.route('**/schema-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="ru"><title>Фикстура миграции</title></html>',
    }),
  );
  await page.goto(`${family.origin}/schema-fixture`);
  const key = await page.evaluate(async (me) => {
    const key = crypto.randomUUID();
    const db = await new Promise<IDBDatabase>((ok, bad) => {
      const request = indexedDB.open('homecrm-offline', 10);
      request.onupgradeneeded = () => {
        const db = request.result;
        const schemas: { name: string; key: string; indexes: string[] }[] = [
          { name: 'identity', key: 'id', indexes: [] },
          { name: 'snapshots', key: 'key', indexes: ['owner', 'capturedAt'] },
          { name: 'outbox', key: 'id', indexes: ['owner', 'entity', 'createdAt', 'state'] },
          { name: 'blobs', key: 'id', indexes: ['owner'] },
          { name: 'drafts', key: 'key', indexes: ['owner'] },
          { name: 'leases', key: 'id', indexes: [] },
        ];
        for (const schema of schemas) {
          const store = db.createObjectStore(schema.name, { keyPath: schema.key });
          for (const name of schema.indexes) store.createIndex(name, name);
        }
      };
      request.onsuccess = () => ok(request.result);
      request.onerror = () => bad(request.error);
    });
    await new Promise<void>((ok, bad) => {
      const tx = db.transaction(['identity', 'outbox', 'blobs', 'drafts'], 'readwrite');
      tx.objectStore('identity').put({
        id: 'active',
        owner: me.id,
        generation: 1,
        verified: false,
        locked: false,
        me: { ...me, email: null, username: null, passwordReset: null },
      });
      const body = {
        title: 'Очередь старой схемы',
        body: 'Сохранено раньше',
        checklist: [],
        pinned: false,
        offline: true,
        ownerAccountId: me.id,
        idempotencyKey: key,
        clientActedAt: new Date().toISOString(),
      };
      tx.objectStore('outbox').put({
        id: key,
        owner: me.id,
        generation: 1,
        house: null,
        entity: `local:${key}`,
        method: 'POST',
        path: 'notes',
        operation: 'note_create',
        body,
        createdAt: Date.now(),
        state: 'pending',
        attempted: false,
        dependencies: [],
        nextAttempt: 0,
        attempts: 0,
      });
      tx.objectStore('blobs').put({
        id: 'migration-blob',
        owner: me.id,
        blob: new Blob(['fixture-photo-bytes'], { type: 'image/png' }),
        name: 'migration.png',
      });
      tx.objectStore('drafts').put({
        key: 'migration-draft',
        owner: me.id,
        data: { title: 'Неотправленный черновик' },
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => ok();
      tx.onerror = () => bad(tx.error);
    });
    db.close();
    return key;
  }, me);
  expect(await rows(page)).toHaveLength(1);

  await context.route('**/api/notes', (route) => route.abort('failed'));
  await page.goto(`${family.baseURL}#/more/offline`);
  await expect(page.getByRole('heading', { level: 1, name: 'Очередь изменений' })).toBeVisible();

  expect((await rows(page))[0]?.id).toBe(key);
  expect(await rows(page, 'blobs')).toHaveLength(1);
  expect(JSON.stringify(await rows(page, 'drafts'))).toContain('Неотправленный черновик');
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((ok) => {
        const request = indexedDB.open('homecrm-offline');
        request.onsuccess = () => ok(request.result);
      });
      const version = db.version;
      db.close();
      return version;
    }),
  ).toBe(20);
  await context.unroute('**/api/notes');
  await updateRow(page, key, { nextAttempt: 0 });
  await sync(page);
  await expect.poll(async () => (await rows(page))[0]?.state, { timeout: 20000 }).toBe('confirmed');
  expect((await rows(page))[0]?.id).toBe(key);
  await context.close();
});

test('SHOP: два дома, личный список, настоящее поле поиска и скрытая запись ребёнка', async ({
  page,
  family,
  browser,
}, info) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  const second = await createHousehold(
    createAuthDatabase(family.database.admin),
    'Вымышленный второй дом',
  );
  await family.database.admin.query(
    "INSERT INTO space_members (space_id,account_id,role) VALUES ($1,$2,'adult')",
    [second, family.person('adult').id],
  );
  await api.post('shopping', {
    title: 'Дом один яблоки',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const target = (
    await api.post('shopping', {
      title: 'Дом два яблоки',
      placement: { spaceId: second, audience: 'household' },
    })
  ).body as { id: string };
  await api.post('shopping', { title: 'Личные яблоки' });
  await api.post('shopping', {
    title: 'Взрослые яблоки',
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  await page.getByLabel('Дом', { exact: true }).selectOption(second);
  await expect(page.getByRole('link', { name: 'Дом два яблоки' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Дом один яблоки' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Личные яблоки' })).toBeVisible();
  await page.goto('#/search');
  await page.getByLabel('Что найти').fill('Дом два яблоки');
  await page.getByRole('link', { name: /Дом два яблоки/ }).click();
  await expect(page).toHaveURL(new RegExp(target.id));
  await check(page, info, 'shopping-card');
  const other = await browser.newContext({ baseURL: family.baseURL });
  const child = await other.newPage();
  await signInAs(child, family, 'child');
  await child.goto('#/search');
  await child.getByLabel('Что найти').fill('Взрослые яблоки');
  await expect(child.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await child.getByLabel('Что найти').fill('Личные яблоки');
  await expect(child.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await other.close();
});
test('OFFLINE: clientId чек-листа проходит две зависимые правки без новых серверных пунктов', async ({
  page,
  family,
  context,
}) => {
  test.setTimeout(120000);
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await page.goto('#/more/notes/new');
  await page.getByLabel('Заголовок', { exact: true }).fill('Чек-лист на устройстве');
  await page.getByRole('button', { name: /Добавить пункт/ }).click();
  await page.getByLabel('Пункт 1', { exact: true }).fill('Ключи');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await queue(page);
  const create = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Чек-лист на устройстве' }) });
  await create.getByRole('checkbox', { name: 'Ключи' }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  const patch = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Правка заметки' }) });
  await patch.getByRole('checkbox', { name: 'Ключи' }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(3);
  await page.reload();
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).every((row) => row.state === 'confirmed'), {
      timeout: 20000,
    })
    .toBe(true);
  const first = (await rows(page)).find((row) => row.operation === 'note_create');
  const id = first?.receipt?.results[0]?.id;
  const card = (await api.get(`notes/${id}`)).body as {
    checklist: { id: string; done: boolean; deletedAt: string | null }[];
  };
  expect(card.checklist.filter((item) => item.deletedAt === null)).toHaveLength(1);
  expect(card.checklist.find((item) => item.deletedAt === null)?.done).toBe(false);
});

test('OFFLINE: single lost ACK сохраняет ключ и Blob; утрата фото даёт отказ, восстановление — ту же квитанцию', async ({
  page,
  family,
  context,
}, info) => {
  test.setTimeout(150000);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, { title: 'Дом одиночного отсчёта' });
  const meter = await seedMeter(api, object.id, {
    title: 'Вода single',
    data: {
      resource: 'cold_water',
      serialNumber: 'TEST-SINGLE',
      zones: ['Вода'],
      status: 'active',
    },
    initial: { occurredOn: '2026-09-20', values: ['100'] },
  });
  await signInAs(page, family, 'adult');
  await shell(page);
  await page.goto(`#/home/${object.id}/readings`);
  await expect(page.getByLabel(/Новое значение/)).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel(/Новое значение/).fill('111');
  await page
    .getByLabel('Фото счётчика: Вода single')
    .setInputFiles([{ name: 'single.png', mimeType: 'image/png', buffer: makePng(90, 90, true) }]);
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  await page.reload();
  await queue(page);
  let committed = false;
  await context.route(`**/api/meters/${meter.id}/readings`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!committed) {
      committed = true;
      await route.fetch();
    }
    await route.abort('failed');
  });
  await context.setOffline(false);
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).find((row) => row.operation === 'reading_create')?.state)
    .toBe('unknown');
  const intent = (await rows(page)).find((row) => row.operation === 'reading_create');
  const upload = (await rows(page)).find((row) => row.operation === 'file_upload');
  expect(intent?.frozenPath).toBe(`meters/${meter.id}/readings`);
  expect(await rows(page, 'blobs')).toHaveLength(1);
  if (!intent || !upload?.receipt?.results[0]) throw new Error('Expected durable graph');
  await updateRow(page, intent.id, { nextAttempt: Date.now() + 60000 });
  const fileId = upload.receipt.results[0].id;
  expect((await api.post(`objects/${object.id}/files/${fileId}/trash`, {})).status).toBe(200);
  await context.unroute(`**/api/meters/${meter.id}/readings`);
  await updateRow(page, intent.id, { nextAttempt: 0 });
  await sync(page);
  await expect
    .poll(async () => (await rows(page)).find((row) => row.id === intent.id)?.state)
    .toBe('error');
  expect(await rows(page, 'blobs')).toHaveLength(1);
  const refused = (await rows(page)).find((row) => row.id === intent.id);
  expect(refused?.frozenBody).toBe(intent.frozenBody);
  await expect(page.getByText(/Запись, права или вложение недоступны/)).toBeVisible();
  await expect(page.getByText(/Показание 1:.*111/)).toBeVisible();
  await page.getByRole('button', { name: 'Проверить показания сервера' }).click();
  await expect(page.getByText(/Серверная версия:.*111/)).toBeVisible();
  await check(page, info, 'offline-reading-missing-photo');
  await page.reload();
  await queue(page);
  expect((await api.post(`objects/${object.id}/files/${fileId}/restore`, {})).status).toBe(200);
  await page.getByRole('button', { name: 'Повторить исходный запрос' }).click();
  await expect
    .poll(async () => (await rows(page)).find((row) => row.id === intent.id)?.state)
    .toBe('confirmed');
  expect((await rows(page)).find((row) => row.id === intent.id)?.frozenBody).toBe(
    intent.frozenBody,
  );
  expect(await rows(page, 'blobs')).toHaveLength(0);
  const readings = (await api.get(`meters/${meter.id}/readings`)).body as {
    values: string[];
    photoIds: string[];
  }[];
  expect(readings.filter((row) => Number(row.values[0]) === 111)).toHaveLength(1);
  expect(readings.find((row) => Number(row.values[0]) === 111)?.photoIds).toEqual([fileId]);
});

test('OFFLINE: повторный ввод черновиков заметки и дела переживает reload без отправки', async ({
  page,
  family,
  context,
}) => {
  await signInAs(page, family, 'adult');
  await shell(page);
  await context.setOffline(true);
  await page.goto('#/more/notes/new');
  await page.getByLabel('Заголовок', { exact: true }).fill('Первый черновик');
  await expect
    .poll(async () => JSON.stringify(await rows(page, 'drafts')))
    .toContain('Первый черновик');
  await page.getByLabel('Заголовок', { exact: true }).fill('Последний черновик');
  await page.getByLabel('Текст', { exact: true }).fill('Второй ввод после autosave');
  await expect
    .poll(async () => JSON.stringify(await rows(page, 'drafts')))
    .toContain('Второй ввод после autosave');
  await page.reload();
  await expect(page.getByLabel('Заголовок', { exact: true })).toHaveValue('Последний черновик');
  await expect(page.getByLabel('Текст', { exact: true })).toHaveValue('Второй ввод после autosave');
  await page.goto('#/today/new');
  await page.getByLabel('Название дела', { exact: true }).fill('Черновик дела');
  await expect
    .poll(async () => JSON.stringify(await rows(page, 'drafts')))
    .toContain('Черновик дела');
  await page.getByLabel('Название дела', { exact: true }).fill('Следующая правка дела');
  await expect
    .poll(async () => JSON.stringify(await rows(page, 'drafts')))
    .toContain('Следующая правка дела');
  await page.reload();
  await expect(page.getByLabel('Название дела', { exact: true })).toHaveValue(
    'Следующая правка дела',
  );
  expect(await rows(page)).toHaveLength(0);
});
