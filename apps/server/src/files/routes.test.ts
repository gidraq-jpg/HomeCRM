import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createWorkerDatabase } from '@homecrm/db';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { cleanupFiles } from './cleanup.ts';
import { FileCipher } from './crypto.ts';
import { MAX_FILE_BYTES } from './media.ts';
import { fileTransactions } from './service.ts';
import { DirectoryStorage } from './storage.ts';

let world: World;
let folder: string;
let storage: DirectoryStorage;
let cipher: FileCipher;
let adult: Device;
let child: Device;
let admin: Device;
let photo: Buffer;
const pdf = Buffer.from('%PDF-1.7\nfictional family\n%%EOF');
const headers = (device: Device) => ({
  cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  origin: BASE_URL,
  'user-agent': device.userAgent,
});
async function upload(
  type: 'notes' | 'objects',
  id: string,
  device = adult,
  data: Buffer = pdf,
  name = 'Семейный файл.pdf',
  mime = 'application/pdf',
) {
  const boundary = 'HomeCrmTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return world.app.inject({
    method: 'POST',
    url: `/api/${type}/${id}/files`,
    headers: { ...headers(device), 'content-type': `multipart/form-data; boundary=${boundary}` },
    remoteAddress: device.ip,
    payload,
  });
}
async function create(type: 'notes' | 'objects', device = adult, common = false) {
  const response = await device.post(`/api/${type}`, {
    title: 'Вымышленная карточка',
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(response.status, response.text).toBe(201);
  return response.json<{ id: string }>().id;
}
const download = (id: string, device = adult, preview = false) =>
  world.app.inject({
    method: 'GET',
    url: `/api/files/${id}${preview ? '/preview' : ''}`,
    headers: headers(device),
    remoteAddress: device.ip,
  });
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-files-api-'));
  storage = new DirectoryStorage(folder);
  cipher = new FileCipher(randomBytes(32), 1);
  world = await createWorld({ files: { storage, cipher } });
  adult = world.device();
  child = world.device();
  expect((await adult.signIn(world.boris.username, world.boris.password)).status).toBe(200);
  expect((await child.signIn(world.vera.username, world.vera.password)).status).toBe(200);
  admin = (await signedInAdmin(world)).device;
  photo = await sharp({ create: { width: 24, height: 18, channels: 3, background: '#aabbcc' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'Fictional Artist' } })
    .toBuffer();
});
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it.each(['notes', 'objects'] as const)(
  '%s: загрузка, карточка, выдача и превью без метаданных и кэша',
  async (type) => {
    const id = await create(type);
    const response = await upload(type, id, adult, photo, 'Фото.html', 'text/html');
    expect(response.statusCode, response.body).toBe(201);
    const file = response.json();
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.hasPreview).toBe(true);
    expect(JSON.stringify(file)).not.toMatch(/storage|envelope|wrappedKey/);
    const card = await adult.get(`/api/${type}/${id}`);
    expect(card.json<{ files: { id: string }[] }>().files[0]?.id).toBe(file.id);
    const result = await download(file.id);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['content-type']).toBe('image/jpeg');
    expect(result.headers['content-disposition']).toMatch(/^attachment;/);
    expect((await sharp(result.rawPayload).metadata()).exif).toBeUndefined();
    const preview = await download(file.id, adult, true);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/webp');
    const { rows } = await world.database.admin.query(
      `SELECT storage_key,preview_storage_key,envelope,preview_envelope FROM ${type === 'notes' ? 'note_files' : 'object_files'} WHERE id=$1`,
      [file.id],
    );
    expect(rows[0].storage_key).not.toBe(rows[0].preview_storage_key);
    expect(rows[0].envelope.wrappedKey).not.toBe(rows[0].preview_envelope.wrappedKey);
    expect((await storage.get(rows[0].storage_key)).includes(photo)).toBe(false);
  },
);
it.each(['notes', 'objects'] as const)(
  '%s: каждая роль — чтение общего, запись взрослого, своё личное ребёнка',
  async (type) => {
    const id = await create(type, adult, true);
    const file = (await upload(type, id)).json();
    for (const device of [adult, admin, child])
      expect((await download(file.id, device)).statusCode).toBe(200);
    expect((await upload(type, id, admin)).statusCode).toBe(201);
    expect((await upload(type, id, child)).statusCode).toBe(403);
    const personal = await create(type, child);
    expect((await upload(type, personal, child)).statusCode).toBe(201);
  },
);
it('чужой, отсутствующий и скрытый ребёнку файл дают одинаковый 404; без cookie — 401', async () => {
  const id = await create('notes');
  const file = (await upload('notes', id)).json();
  const hidden = await download(file.id, admin);
  const absent = await download(randomUUID(), admin);
  expect(hidden.statusCode).toBe(404);
  expect(hidden.body).toBe(absent.body);
  expect(hidden.headers['cache-control']).toBe('no-store');
  const shared = await create('objects', adult, true);
  await adult.post(`/api/objects/${shared}/audience`, { audience: 'adults', confirmed: true });
  const restricted = (await upload('objects', shared)).json();
  expect((await download(restricted.id, child)).statusCode).toBe(404);
  expect((await world.app.inject(`/api/files/${file.id}`)).statusCode).toBe(401);
});
it('подмена содержимого и 25 МБ + 1 байт не создают строки или блоки; ровно 25 МБ PDF допустимы', async () => {
  const id = await create('notes');
  const before = await readdir(folder);
  expect(
    (
      await upload(
        'notes',
        id,
        adult,
        Buffer.from('<html>not a photo</html>'),
        'fake.jpg',
        'image/jpeg',
      )
    ).statusCode,
  ).toBe(415);
  expect((await upload('notes', id, adult, Buffer.alloc(MAX_FILE_BYTES + 1))).statusCode).toBe(413);
  expect(await readdir(folder)).toEqual(before);
  const exact = Buffer.alloc(MAX_FILE_BYTES, 32);
  pdf.copy(exact);
  expect((await upload('notes', id, adult, exact)).statusCode).toBe(201);
});
it.each(['notes', 'objects'] as const)(
  '%s: перенос, отдельная корзина, каскадное восстановление и независимая копия',
  async (type) => {
    const id = await create(type);
    const file = (await upload(type, id)).json();
    expect(
      (
        await adult.post(`/api/${type}/${id}/share`, {
          spaceId: world.houseId,
          audience: 'household',
        })
      ).status,
    ).toBe(200);
    expect((await download(file.id, child)).statusCode).toBe(200);
    const second = (await upload(type, id)).json();
    expect((await adult.post(`/api/${type}/${id}/files/${second.id}/trash`)).status).toBe(200);
    expect((await adult.post(`/api/${type}/${id}/trash`)).status).toBe(200);
    expect((await adult.post(`/api/${type}/${id}/restore`)).status).toBe(200);
    const table = type === 'notes' ? 'note_files' : 'object_files';
    const rows = (
      await world.database.admin.query(`SELECT id,deleted_at FROM ${table} WHERE parent_id=$1`, [
        id,
      ])
    ).rows;
    expect(rows.find((row) => row.id === file.id).deleted_at).toBeNull();
    expect(rows.find((row) => row.id === second.id).deleted_at).not.toBeNull();
    const copy = await child.post(`/api/${type}/${id}/copy`);
    expect(copy.status, copy.text).toBe(201);
    const copied = copy.json<{ files: { id: string }[] }>().files;
    expect(copied).toHaveLength(1);
    expect(copied[0]?.id).not.toBe(file.id);
    expect((await download(copied[0]?.id ?? '', child)).rawPayload).toEqual(pdf);
    expect((await download(copied[0]?.id ?? '', adult)).statusCode).toBe(404);
  },
);
it.each(['notes', 'objects'] as const)(
  '%s: добавление и удаление файла другим участником — необратимый вклад',
  async (type) => {
    const id = await create(type, adult, true);
    expect((await upload(type, id, admin)).statusCode).toBe(201);
    expect((await adult.post(`/api/${type}/${id}/personal`, { confirmed: true })).status).toBe(403);
    const other = await create(type, adult, true);
    const file = (await upload(type, other)).json();
    expect((await admin.post(`/api/${type}/${other}/files/${file.id}/trash`)).status).toBe(200);
    expect((await adult.post(`/api/${type}/${other}/personal`, { confirmed: true })).status).toBe(
      403,
    );
  },
);
it('photoFileId принимает только свой живой image; чужой, отсутствующий и PDF отклонены одинаково', async () => {
  const id = await create('notes', adult, true);
  const image = (await upload('notes', id, adult, photo)).json();
  const document = (await upload('notes', id)).json();
  expect(
    (await adult.request('PATCH', '/api/me/profile', { json: { photoFileId: image.id } })).status,
  ).toBe(200);
  for (const photoFileId of [image.id, document.id, randomUUID()])
    expect(
      (await admin.request('PATCH', '/api/me/profile', { json: { photoFileId } })).status,
    ).toBe(403);
  expect(
    (await adult.request('PATCH', '/api/me/profile', { json: { photoFileId: document.id } }))
      .status,
  ).toBe(403);
  await adult.post(`/api/notes/${id}/audience`, { audience: 'adults', confirmed: true });
  expect((await download(image.id, child)).statusCode).toBe(404);
});
it('сбой блока и COMMIT не оставляет строки и блоков', async () => {
  const id = await create('notes');
  const before = await readdir(folder);
  const put = storage.put.bind(storage);
  storage.put = async (key, data) => {
    await put(key, data);
    throw new Error('fictional storage failure');
  };
  try {
    expect((await upload('notes', id)).statusCode).toBe(500);
  } finally {
    storage.put = put;
  }
  expect(await readdir(folder)).toEqual(before);
  expect((await adult.get(`/api/notes/${id}/files`)).json()).toEqual([]);
  let handlerFinished = false;
  const db = fileTransactions(world.module.appDb, { storage, cipher });
  await expect(
    db.withAccount(world.boris.id, async (tx) => {
      const { insertFile } = await import('./service.ts');
      const { notes, eq } = await import('@homecrm/db');
      const [parent] = await tx.select().from(notes).where(eq(notes.id, id));
      if (!parent) throw new Error('parent');
      await insertFile(tx, { id: world.boris.id } as never, 'note', parent, {
        data: pdf,
        mimeType: 'application/pdf',
        name: 'Тест.pdf',
      });
      await tx.execute(
        (await import('@homecrm/db'))
          .sql`UPDATE note_files SET space_id=${world.houseId},space_kind='household',audience='household' WHERE parent_id=${id}`,
      );
      handlerFinished = true;
    }),
  ).rejects.toThrow();
  expect(handlerFinished).toBe(true);
  // При неизвестном исходе COMMIT решение принимает сверка с реестром живых блоков.
  await cleanupFiles(
    createWorkerDatabase(world.database.worker),
    storage,
    new Date(Date.now() + 1000),
  );
  expect(await readdir(folder)).toEqual(before);
});
it('очистка корзины стирает блоки, живые ссылки сохраняются; осиротевший блок удаляется', async () => {
  const id = await create('objects');
  const file = (await upload('objects', id)).json();
  const row = (
    await world.database.admin.query('SELECT storage_key FROM object_files WHERE id=$1', [file.id])
  ).rows[0];
  await world.database.admin.query(
    'ALTER TABLE object_files DISABLE TRIGGER object_files_trash_time; ALTER TABLE objects DISABLE TRIGGER objects_trash_time',
  );
  await world.database.admin.query(
    "UPDATE objects SET deleted_at=now()-interval '31 days' WHERE id=$1",
    [id],
  );
  await world.database.admin.query(
    'ALTER TABLE object_files ENABLE TRIGGER object_files_trash_time; ALTER TABLE objects ENABLE TRIGGER objects_trash_time',
  );

  const orphan = randomUUID();
  await storage.put(orphan, Buffer.from('encrypted orphan'));
  const worker = createWorkerDatabase(world.database.worker);
  expect(await cleanupFiles(worker, storage, new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(
    2,
  );
  await expect(storage.get(row.storage_key)).rejects.toThrow();
  await expect(storage.get(orphan)).rejects.toThrow();
  expect(
    (await world.database.admin.query('SELECT count(*)::int n FROM file_blobs')).rows[0].n,
  ).toBe((await readdir(folder)).length);
});
it('журналы и история не содержат ключи, storage path и конверты', async () => {
  const log = world.requestLog.join('\n');
  expect(log).not.toContain('Семейный файл.pdf');
  expect(log).not.toContain(folder);
  expect(log).not.toContain('wrappedKey');
  expect(log).not.toContain('storage_key');
  const history = (
    await world.database.admin.query(
      'SELECT changes::text value FROM note_files_history UNION ALL SELECT changes::text FROM object_files_history',
    )
  ).rows;
  expect(history.length).toBeGreaterThan(0);
  expect(history.every((row) => !/(storage_key|envelope)/.test(row.value))).toBe(true);
});

it('копия с ошибкой второго блока откатывается целиком и не оставляет orphan', async () => {
  const id = await create('notes');
  expect((await upload('notes', id, adult, photo)).statusCode).toBe(201);
  const before = (await readdir(folder)).sort();
  const put = storage.put.bind(storage);
  let count = 0;
  storage.put = async (key, data) => {
    await put(key, data);
    if (++count === 2) throw new Error('fictional preview failure');
  };
  try {
    expect((await adult.post(`/api/notes/${id}/copy`)).status).toBe(500);
  } finally {
    storage.put = put;
  }
  expect((await readdir(folder)).sort()).toEqual(before);
});
it('профиль и состав скрывают UUID недоступного фото; ссылка в DB сохраняется', async () => {
  const id = await create('notes');
  const image = (await upload('notes', id, adult, photo)).json();
  expect(
    (await adult.request('PATCH', '/api/me/profile', { json: { photoFileId: image.id } })).status,
  ).toBe(200);
  const roster = await admin.get(`/api/households/${world.houseId}/members`);
  expect(roster.status, roster.text).toBe(200);
  expect(
    roster
      .json<{ accountId: string; photoFileId: string | null }[]>()
      .find((row) => row.accountId === world.boris.id)?.photoFileId,
  ).toBeNull();
  expect((await adult.get('/api/me/profile')).json<{ photoFileId: string }>().photoFileId).toBe(
    image.id,
  );
  await adult.post(`/api/notes/${id}/files/${image.id}/trash`);
  expect(
    (await adult.get('/api/me/profile')).json<{ photoFileId: string | null }>().photoFileId,
  ).toBeNull();
  expect(
    (
      await world.database.admin.query(
        'SELECT photo_file_id FROM member_profiles WHERE account_id=$1',
        [world.boris.id],
      )
    ).rows[0].photo_file_id,
  ).toBe(image.id);
});
it('экспорт готовит только своё личное и общее администрируемого дома, без storage keys', async () => {
  const { exportFiles } = await import('./export.ts');
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
  const files = await world.module.appDb.withAccount(account.id, (tx) =>
    exportFiles(tx, account, { storage, cipher }),
  );
  expect(files.length).toBeGreaterThan(0);
  expect(files.every((file) => file.parentType === 'note' || file.parentType === 'object')).toBe(
    true,
  );
  expect(files.every((file) => Buffer.isBuffer(file.data))).toBe(true);
  expect(JSON.stringify(files.map(({ data, ...meta }) => meta))).not.toMatch(
    /storage|envelope|wrappedKey/,
  );
});

it('R0.5d: медленная загрузка не держит блокировку; повторная проверка отклоняет родителя из корзины', async () => {
  const id = await create('objects');
  const before = await readdir(folder);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  async function* body() {
    yield Buffer.from(
      '--SlowBoundary\r\nContent-Disposition: form-data; name="file"; filename="fictional.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    );
    yield pdf;
    started();
    await gate;
    yield Buffer.from('\r\n--SlowBoundary--\r\n');
  }
  const pending = world.app
    .inject({
      method: 'POST',
      url: `/api/objects/${id}/files`,
      headers: { ...headers(adult), 'content-type': 'multipart/form-data; boundary=SlowBoundary' },
      remoteAddress: adult.ip,
      payload: Readable.from(body()),
    })
    .then((value) => value);
  await began;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      adult.post(`/api/objects/${id}/trash`, {}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Upload held parent lock')), 1500);
      }),
    ]);
    expect(result.status, result.text).toBe(200);
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
  expect((await pending).statusCode).toBe(403);
  expect(await readdir(folder)).toEqual(before);
});
it('R0.5d: шифрование загрузки выполняется вне транзакции участника', async () => {
  const id = await create('notes');
  const originalDb = world.module.appDb.withAccount.bind(world.module.appDb);
  const originalSeal = cipher.seal.bind(cipher);
  let active = 0,
    sealed = 0;
  world.module.appDb.withAccount = (id, fn) =>
    originalDb(id, async (tx) => {
      active++;
      try {
        return await fn(tx);
      } finally {
        active--;
      }
    });
  cipher.seal = (...args) => {
    expect(active).toBe(0);
    sealed++;
    return originalSeal(...args);
  };
  try {
    const result = await upload('notes', id, adult, photo, 'fictional.jpg', 'image/jpeg');
    expect(result.statusCode, result.body).toBe(201);
    expect(sealed).toBe(2);
  } finally {
    world.module.appDb.withAccount = originalDb;
    cipher.seal = originalSeal;
  }
});
it('R0.5d: ошибка после успешного COMMIT сохраняет блоки живой строки', async () => {
  const id = await create('notes');
  const wrapped = fileTransactions(
    {
      async withAccount(accountId, fn) {
        await world.module.appDb.withAccount(accountId, fn);
        throw new Error('Commit response lost');
      },
    },
    { storage, cipher },
  );
  let fileId = '';
  await expect(
    wrapped.withAccount(world.boris.id, async (tx) => {
      const { insertFile } = await import('./service.ts');
      const { notes, eq } = await import('@homecrm/db');
      const [parent] = await tx.select().from(notes).where(eq(notes.id, id));
      if (!parent) throw new Error('parent');
      fileId = (
        await insertFile(tx, { id: world.boris.id } as never, 'note', parent, {
          data: pdf,
          mimeType: 'application/pdf',
          name: 'Сохранённый.pdf',
        })
      ).id;
    }),
  ).rejects.toThrow('Commit response lost');
  await cleanupFiles(
    createWorkerDatabase(world.database.worker),
    storage,
    new Date(Date.now() + 1000),
  );
  const result = await download(fileId);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.rawPayload).toEqual(pdf);
});
