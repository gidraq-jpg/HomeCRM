import { randomBytes, randomUUID } from 'node:crypto';
import { createAppDatabase, sql } from '@homecrm/db';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { aiProvider, loadAiConfig } from '../ai/config.ts';
import { buildArchive } from '../export/archive.ts';
import { FileCipher } from '../files/crypto.ts';
import type { FileServices } from '../files/service.ts';
import { fileTransactions } from '../files/service.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { cleanupInbox } from './jobs.ts';

let world: World;
let administrator: Awaited<ReturnType<typeof signedInAdmin>>;
const blocks = new Map<string, Buffer>();
const files: FileServices = {
  cipher: new FileCipher(randomBytes(32), 1),
  storage: {
    async put(key, bytes) {
      blocks.set(key, bytes);
    },
    async get(key) {
      const bytes = blocks.get(key);
      if (!bytes) throw new Error('Missing test block');
      return bytes;
    },
    async delete(key) {
      blocks.delete(key);
    },
    async *olderThan() {
      yield* blocks.keys();
    },
  },
};
beforeAll(async () => {
  world = await createWorld({ files, ai: config });
  administrator = await signedInAdmin(world);
});
it('INBOX-1/4: несколько шифрованных страниц переносятся атомарно, повтор не дублирует их', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const bytes = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const body = {
    ...capture('Учебные страницы договора'),
    files: [
      { name: 'Учебная 1.png', base64: bytes.toString('base64') },
      { name: 'Учебная 2.png', base64: bytes.toString('base64') },
    ],
  };
  const captured = await adult.post('/api/inbox', body);
  expect(captured.status, captured.text).toBe(201);
  const list = (await adult.get('/api/inbox')).json<{ id: string; files: { id: string }[] }[]>();
  const incoming = list.find((r) => r.id === body.id);
  expect(incoming?.files).toHaveLength(2);
  const doc = await adult.post('/api/documents', {
    title: 'Учебный договор для страниц',
    data: { type: 'contract' },
    owner: { kind: 'member', id: world.boris.id },
  });
  expect(doc.status).toBe(201);
  const target = { type: 'document', id: doc.json().id };
  for (let i = 0; i < 2; i++)
    expect((await adult.post(`/api/inbox/${body.id}/resolve`, target)).status).toBe(200);
  const rows = await world.database.admin.query(
    'SELECT storage_key,envelope FROM document_files WHERE parent_id=$1',
    [target.id],
  );
  expect(rows.rows).toHaveLength(2);
  for (const row of rows.rows)
    expect(
      files.cipher.open(await files.storage.get(row.storage_key), row.envelope, row.storage_key),
    ).toEqual(bytes);
  const { device: admin } = administrator;
  expect((await admin.get(`/api/files/${incoming?.files[0]?.id}`)).status).toBe(404);
});
it('INBOX-5: 30 дней до корзины, затем ещё 30 до удаления; личный экспорт содержит входящие', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const body = {
    ...capture('Учебный экспорт входящих'),
    files: [
      { name: 'Учебный.pdf', base64: Buffer.from('%PDF-1.7\nfictional\n%%EOF').toString('base64') },
    ],
  };
  expect((await adult.post('/api/inbox', body)).status).toBe(201);
  const db = fileTransactions(createAppDatabase(world.database.app), files);
  const account = {
    id: world.boris.id,
    sessionId: randomUUID(),
    displayName: 'Борис',
    username: 'boris',
    email: null,
    twoFactorEnabled: false,
    secondFactorPending: false,
    viewer: {
      accountId: world.boris.id,
      memberships: new Map([[world.houseId, 'adult' as const]]),
    },
  };
  const archive = await db.withAccount(account.id, (tx) =>
    buildArchive(
      tx,
      account,
      { kind: 'personal' },
      files,
      'Asia/Yekaterinburg',
      new AbortController().signal,
    ),
  );
  expect(archive.manifest.counts.inbox_items).toBeGreaterThan(0);
  expect(archive.manifest.counts.inbox_files).toBeGreaterThan(0);
  await archive.cleanup();
  expect(
    (
      await world.database.worker.query('UPDATE inbox_items SET deleted_at=now() WHERE id=$1', [
        body.id,
      ])
    ).rowCount,
  ).toBe(0);
  await expect(
    world.database.worker.query('SELECT text,draft FROM inbox_items'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    world.database.worker.query('SELECT storage_key,envelope FROM inbox_files'),
  ).rejects.toMatchObject({ code: '42501' });
  await age(body.id, 'created_at');
  await cleanupInbox(world.database.worker);
  expect(
    (await world.database.admin.query('SELECT deleted_at FROM inbox_items WHERE id=$1', [body.id]))
      .rows[0].deleted_at,
  ).not.toBeNull();
  expect(
    (
      await world.database.admin.query('SELECT deleted_at FROM inbox_files WHERE parent_id=$1', [
        body.id,
      ])
    ).rows[0]?.deleted_at,
  ).not.toBeNull();
  expect((await adult.post(`/api/inbox/${body.id}/restore`, {})).status).toBe(200);
  await cleanupInbox(world.database.worker);
  expect(
    (await adult.get('/api/inbox')).json<{ id: string }[]>().some((item) => item.id === body.id),
  ).toBe(true);
  expect((await adult.post(`/api/inbox/${body.id}/trash`, {})).status).toBe(200);
  await age(body.id, 'deleted_at');
  await cleanupInbox(world.database.worker);
  expect(
    (await world.database.admin.query('SELECT id FROM inbox_items WHERE id=$1', [body.id]))
      .rowCount,
  ).toBe(0);
});
async function age(id: string, field: 'created_at' | 'deleted_at') {
  const client = await world.database.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE inbox_items DISABLE TRIGGER USER');
    await client.query(`UPDATE inbox_items SET ${field}=now()-interval '31 days' WHERE id=$1`, [
      id,
    ]);
    await client.query('ALTER TABLE inbox_items ENABLE TRIGGER USER');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
it('AI-7: дневной предел возвращает 429 и сохраняет безопасный статус ошибки', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await world.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    world.houseId,
  ]);
  await createAppDatabase(world.database.app).withAccount(world.boris.id, (tx) =>
    tx.execute(
      sql`SELECT app.consume_ai_request(${world.houseId}::uuid,${config.AI_DAILY_LIMIT}::integer) FROM generate_series(1,${config.AI_DAILY_LIMIT}::integer)`,
    ),
  );
  const input = capture('Учебная заметка после предела');
  await adult.post('/api/inbox', input);
  const response = await adult.post(`/api/inbox/${input.id}/parse`, {});
  expect(response.status).toBe(429);
  expect(response.json().code).toBe('AI_DAILY_LIMIT');
  expect(
    (
      await world.database.admin.query(
        'SELECT status,draft,error_code FROM inbox_items WHERE id=$1',
        [input.id],
      )
    ).rows[0],
  ).toEqual({ status: 'error', draft: null, error_code: 'AI_DAILY_LIMIT' });
  await world.database.admin.query('DELETE FROM ai_daily_usage WHERE house_id=$1', [world.houseId]);
  await world.database.admin.query('UPDATE spaces SET ai_enabled=false WHERE id=$1', [
    world.houseId,
  ]);
});
afterAll(async () => {
  await world?.close();
});
const config = loadAiConfig({ AI_EXTRACT_PROVIDER: 'fake' });
function capture(text: string, id = randomUUID()) {
  return {
    id,
    source: 'text',
    text,
    houseId: world.houseId,
    consent: `v4:${aiProvider(config)}`,
    idempotencyKey: id,
    ownerAccountId: world.boris.id,
    offline: true,
  };
}
it('INBOX-1/5: повтор не создаёт дубликат; взрослый, ребёнок и администратор не видят чужое', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const body = capture('Учебная заметка 4711');
  const first = await adult.post('/api/inbox', body);
  expect(first.status).toBe(201);
  expect((await adult.post('/api/inbox', body)).json().id).toBe(body.id);
  expect((await adult.post('/api/inbox', { ...body, text: 'Изменено' })).status).toBe(409);
  const { device: admin } = administrator;
  const child = world.device();
  await child.signIn(world.vera.username, world.vera.password);
  for (const device of [admin, child]) {
    expect((await device.get('/api/inbox')).json()).toEqual([]);
    expect((await device.post(`/api/inbox/${body.id}/trash`, {})).status).toBe(404);
    expect((await device.post(`/api/inbox/${body.id}/parse`, {})).status).toBe(404);
  }
  expect(world.requestLog.join('')).not.toContain(body.text);
});
it('INBOX-2, AI-3/4: без включения ждёт; личность — пустой черновик, расход один', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const input = capture('Учебный паспорт: Вымышленный Персонаж 0000 000000');
  expect((await adult.post('/api/inbox', input)).status).toBe(201);
  expect((await adult.post(`/api/inbox/${input.id}/parse`, {})).status).toBe(200);
  expect(
    (await world.database.admin.query('SELECT status FROM inbox_items WHERE id=$1', [input.id]))
      .rows[0].status,
  ).toBe('new');
  await world.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    world.houseId,
  ]);
  expect((await adult.post(`/api/inbox/${input.id}/parse`, {})).status).toBe(200);
  expect(
    (
      await world.database.admin.query('SELECT status,draft FROM inbox_items WHERE id=$1', [
        input.id,
      ])
    ).rows[0],
  ).toEqual({ status: 'identity', draft: null });
  expect((await adult.post(`/api/inbox/${input.id}/parse`, {})).status).toBe(200);
  expect(
    (
      await world.database.admin.query('SELECT requests FROM ai_daily_usage WHERE house_id=$1', [
        world.houseId,
      ])
    ).rows[0]?.requests,
  ).toBe(1);
  const log = world.requestLog.join('');
  for (const secret of ['Вымышленный Персонаж', '0000 000000']) expect(log).not.toContain(secret);
});
it('INBOX-4/5: обычный API создаёт запись; разбор завершает только автор, корзина восстанавливается', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const body = capture('Позвонить в учебную мастерскую');
  await adult.post('/api/inbox', body);
  expect((await adult.post(`/api/inbox/${body.id}/parse`, {})).status).toBe(200);
  expect(
    (await world.database.admin.query('SELECT status FROM inbox_items WHERE id=$1', [body.id]))
      .rows[0].status,
  ).toBe('ready');
  expect((await adult.post(`/api/inbox/${body.id}/trash`, {})).status).toBe(200);
  expect((await adult.post(`/api/inbox/${body.id}/restore`, {})).status).toBe(200);
  const task = await adult.post('/api/tasks', {
    title: 'Учебное дело',
    placement: { spaceId: world.boris.personalSpaceId },
  });
  expect(task.status).toBe(201);
  const target = { type: 'task', id: task.json().id };
  expect((await adult.post(`/api/inbox/${body.id}/resolve`, target)).status).toBe(200);
  expect((await adult.post(`/api/inbox/${body.id}/resolve`, target)).status).toBe(200);
  expect((await adult.get('/api/inbox')).text).not.toContain(body.id);
});

it('AI-5: у покупки нет вложений; после подтверждения исходные страницы и блоки удалены', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const image = await sharp({ create: { width: 30, height: 30, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const body = {
    ...capture('Купить учебный блокнот'),
    files: [{ name: 'Учебный блокнот.png', base64: image.toString('base64') }],
  };
  expect((await adult.post('/api/inbox', body)).status).toBe(201);
  const original = (
    await world.database.admin.query(
      'SELECT storage_key,preview_storage_key FROM inbox_files WHERE parent_id=$1',
      [body.id],
    )
  ).rows[0];
  const purchase = await adult.post('/api/shopping', {
    title: 'Учебный блокнот',
    placement: { spaceId: world.boris.personalSpaceId },
  });
  expect(purchase.status).toBe(201);
  expect(
    (
      await adult.post(`/api/inbox/${body.id}/resolve`, {
        type: 'shopping_item',
        id: purchase.json().id,
      })
    ).status,
  ).toBe(200);
  expect(
    (await world.database.admin.query('SELECT id FROM inbox_files WHERE parent_id=$1', [body.id]))
      .rowCount,
  ).toBe(0);
  expect(blocks.has(original.storage_key)).toBe(false);
  expect(blocks.has(original.preview_storage_key)).toBe(false);
  expect(
    (await world.database.admin.query("SELECT to_regclass('shopping_files') AS name")).rows[0].name,
  ).toBeNull();
});
it('INBOX-4: в смешанном элементе покупки сохраняются, страницы переходят к заметке', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const image = await sharp({ create: { width: 30, height: 30, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const body = {
    ...capture('Купить учебный блокнот и заметка: учебный договор лежит в ящике'),
    files: [{ name: 'Учебный договор.png', base64: image.toString('base64') }],
  };
  expect((await adult.post('/api/inbox', body)).status).toBe(201);
  expect((await adult.post(`/api/inbox/${body.id}/parse`, {})).status).toBe(200);
  const parsed = (
    await world.database.admin.query('SELECT draft FROM inbox_items WHERE id=$1', [body.id])
  ).rows[0].draft;
  expect(parsed.classification.kind).toBe('note');
  expect(parsed.additional[0].classification.kind).toBe('shopping');
  const note = await adult.post('/api/notes', { title: 'Учебный договор с приложением' });
  const purchase = await adult.post('/api/shopping', {
    title: 'Учебный блокнот',
    placement: { spaceId: world.boris.personalSpaceId },
  });
  expect(
    (
      await adult.post(`/api/inbox/${body.id}/resolve`, {
        targets: [
          { type: 'shopping_item', id: purchase.json().id },
          { type: 'note', id: note.json().id },
        ],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await world.database.admin.query('SELECT id FROM note_files WHERE parent_id=$1', [
        note.json().id,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (await world.database.admin.query('SELECT id FROM inbox_files WHERE parent_id=$1', [body.id]))
      .rowCount,
  ).toBe(0);
});
