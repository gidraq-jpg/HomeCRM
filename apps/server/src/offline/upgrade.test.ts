import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskFields } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../../../../packages/db/src/migrate.ts';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World,
  device: Device,
  folder: string,
  before: unknown,
  taskId: string,
  noteId: string,
  shoppingId: string,
  fileId: string;
const keys = { create: randomUUID(), patch: randomUUID(), status: randomUUID() };
let createBody: Record<string, unknown>,
  patchBody: Record<string, unknown>,
  statusBody: Record<string, unknown>;
const snapshot = async () =>
  (
    await world.database.admin.query(`SELECT * FROM (
 SELECT 'tasks' source,to_jsonb(t) value FROM tasks t
 UNION ALL SELECT 'tasks_history',to_jsonb(t) FROM tasks_history t
 UNION ALL SELECT 'shopping_items',to_jsonb(t)-'data' FROM shopping_items t
 UNION ALL SELECT 'shopping_items_history',to_jsonb(t) FROM shopping_items_history t
 UNION ALL SELECT 'notes',to_jsonb(t) FROM notes t
 UNION ALL SELECT 'notes_history',to_jsonb(t) FROM notes_history t
 UNION ALL SELECT 'object_files',to_jsonb(t) FROM object_files t
 UNION ALL SELECT 'note_files',to_jsonb(t) FROM note_files t
 UNION ALL SELECT 'file_blobs',to_jsonb(t) FROM file_blobs t
 UNION ALL SELECT 'api_operations',to_jsonb(t)-'receipt' FROM api_operations t
) records ORDER BY source,value::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-offline-upgrade-'));
  const migrations = join(folder, 'migrations');
  await mkdir(join(migrations, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 63);
  await writeFile(join(migrations, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(migrations, `${entry.tag}.sql`));
  world = await createWorld({
    migrationsFolder: migrations,
    files: {
      storage: new DirectoryStorage(join(folder, 'files')),
      cipher: new FileCipher(randomBytes(32), 1),
    },
  });
  device = world.device();
  await device.signIn(world.boris.username, world.boris.password);
  const placement = { spaceId: world.houseId, audience: 'household' };
  const created = await device.post('/api/tasks', { title: 'Живое дело версии0063', placement });
  expect(created.status, created.text).toBe(201);
  const task = created.json<{ id: string; updatedAt: string }>();
  taskId = task.id;
  createBody = { title: 'Живое дело версии0063', placement, idempotencyKey: keys.create };
  // Точный порядок канонических полей прежнего TaskFields.extend/create, без новых default.
  const createCanonical = {
    ...TaskFields.parse({ title: createBody.title }),
    placement,
    links: [],
    expandAudience: false,
    idempotencyKey: keys.create,
  };
  patchBody = {
    title: 'Правка версии0063',
    expectedUpdatedAt: task.updatedAt,
    idempotencyKey: keys.patch,
  };
  const patched = await device.request('PATCH', `/api/tasks/${task.id}`, {
    json: { title: patchBody.title, expectedUpdatedAt: task.updatedAt },
  });
  expect(patched.status, patched.text).toBe(200);
  const patchCanonical = { repeatScope: 'this', expandAudience: false, ...patchBody };
  statusBody = {
    status: 'done',
    expectedUpdatedAt: patched.json<{ updatedAt: string }>().updatedAt,
    idempotencyKey: keys.status,
  };
  expect(
    (
      await device.post(`/api/tasks/${task.id}/status`, {
        status: 'done',
        expectedUpdatedAt: statusBody.expectedUpdatedAt,
      })
    ).status,
  ).toBe(200);
  for (const [operation, body] of [
    ['task_create', createCanonical],
    ['task_patch', patchCanonical],
    ['task_status', statusBody],
  ] as const)
    await world.database.admin.query(
      'INSERT INTO api_operations(account_id,key,operation,fingerprint,result_ids) VALUES($1,$2,$3,$4,$5)',
      [
        world.boris.id,
        (body as Record<string, unknown>).idempotencyKey,
        operation,
        createHash('sha256')
          .update(JSON.stringify(operation === 'task_create' ? body : { id: taskId, body }))
          .digest('hex'),
        JSON.stringify([task.id]),
      ],
    );
  noteId = (await device.post('/api/notes', { title: 'Заметка версии0063', placement })).json<{
    id: string;
  }>().id;
  const boundary = 'UpgradeFileBoundary';
  const upload = await world.app.inject({
    method: 'POST',
    url: `/api/notes/${noteId}/files`,
    remoteAddress: device.ip,
    headers: {
      cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: BASE_URL,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="old.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\nfictional migration file\n%%EOF\r\n--${boundary}--\r\n`,
    ),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  fileId = upload.json().id;
  shoppingId = (
    await world.database.admin.query(
      "INSERT INTO shopping_items(space_id,space_kind,audience,author_id,title,quantity,bought_at) VALUES($1,'household','household',$2,'Покупка версии0063','2 пачки',now()-interval '2 days') RETURNING id",
      [world.houseId, world.boris.id],
    )
  ).rows[0].id;
  before = await snapshot();
  await runMigrations(world.database.owner);
});
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('R1c.7–8: обновление0063→0064 сохраняет строки, историю, bytes/envelopes/blob registry и живые старые квитанции', async () => {
  expect(await snapshot()).toEqual(before);
  expect((await device.get(`/api/shopping/${shoppingId}`)).json()).toMatchObject({
    quantity: '2 пачки',
    data: { note: '', store: '', category: '' },
  });
  expect((await device.get(`/api/files/${fileId}`)).text).toBe(
    '%PDF-1.7\nfictional migration file\n%%EOF',
  );
  expect(
    (
      await world.database.admin.query('SELECT receipt FROM api_operations WHERE account_id=$1', [
        world.boris.id,
      ])
    ).rows,
  ).toEqual([{ receipt: null }, { receipt: null }, { receipt: null }]);
});
it('R1c.8: настоящие legacy task_create/patch/status хэши replay без ложного409 и без выдуманной metadata', async () => {
  const count = (await device.get(`/api/tasks/${taskId}/history`)).json<unknown[]>().length;
  for (const response of [
    await device.post('/api/tasks', createBody),
    await device.request('PATCH', `/api/tasks/${taskId}`, { json: patchBody }),
    await device.post(`/api/tasks/${taskId}/status`, statusBody),
  ]) {
    expect(response.status, response.text).toBeLessThan(300);
    expect(response.json().id).toBe(taskId);
    expect(response.json().receipt).toBeUndefined();
  }
  expect((await device.get(`/api/tasks/${taskId}/history`)).json<unknown[]>()).toHaveLength(count);
  expect(
    (
      await device.post('/api/tasks', {
        ...createBody,
        offline: true,
        ownerAccountId: world.boris.id,
      })
    ).json().code,
  ).toBe('IDEMPOTENCY_CONFLICT');
});
