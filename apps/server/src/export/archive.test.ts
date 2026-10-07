import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppDatabase, sql } from '@homecrm/db';
import { ExportManifest, ExportRecords, type ExportScope } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fromBuffer, open, type ZipFile } from 'yauzl';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type Person, type World } from '../testing/world.ts';
import { buildArchive } from './archive.ts';

let world: World;
let folder: string;
let storage: DirectoryStorage;
let cipher: FileCipher;
let admin: Device;
let adult: Device;
let child: Device;
const payload = Buffer.from('%PDF-1.7\nfictional export original\n%%EOF');
const ids = new Map<string, { note: string; object: string; file: string; photo: string }>();
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function unpack(source: Buffer | string) {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    const callback = (error: Error | null, result?: ZipFile) =>
      error ? reject(error) : result ? resolve(result) : reject(new Error('Missing ZIP'));
    if (typeof source === 'string') open(source, { lazyEntries: true }, callback);
    else fromBuffer(source, { lazyEntries: true }, callback);
  });
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) =>
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error('Missing entry'));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => {
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      }),
    );
    zip.readEntry();
  });
  return entries;
}
function json(entries: Map<string, Buffer>, name: string) {
  return JSON.parse(entries.get(`${name}.json`)?.toString() ?? 'null');
}
async function archive(
  device: Device,
  password: string,
  scope: ExportScope = { kind: 'personal' },
) {
  return world.app.inject({
    method: 'POST',
    url: '/api/export/archive',
    remoteAddress: device.ip,
    headers: {
      cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: BASE_URL,
    },
    payload: { password, scope, confirmed: true },
  });
}
async function seed(
  person: Person,
  spaceId: string,
  kind: 'personal' | 'household',
  audience: string | null,
) {
  const [note, object, file, photo] = Array.from({ length: 4 }, () => randomUUID()) as [
    string,
    string,
    string,
    string,
  ];
  const key = randomUUID();
  const sealed = cipher.seal(payload, key);
  await storage.put(key, sealed.block);
  await world.database.admin.query(
    `INSERT INTO notes(id,space_id,space_kind,audience,author_id,title,body) VALUES($1,$2,$3,$4,$5,$6,'**Markdown**')`,
    [note, spaceId, kind, audience, person.id, `Запись ${kind} ${person.key}`],
  );
  await world.database.admin.query(
    `INSERT INTO note_items(space_id,space_kind,audience,author_id,title,parent_id,done) VALUES($1,$2,$3,$4,'Пункт',$5,true)`,
    [spaceId, kind, audience, person.id, note],
  );
  await world.database.admin.query(
    `INSERT INTO objects(id,space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,$5,'Объект')`,
    [object, spaceId, kind, audience, person.id],
  );
  await world.database.admin.query(
    `INSERT INTO object_fields(space_id,space_kind,audience,author_id,title,parent_id,value) VALUES($1,$2,$3,$4,'Поле',$5,'Значение')`,
    [spaceId, kind, audience, person.id, object],
  );
  await world.database.admin.query(
    `INSERT INTO object_events(space_id,space_kind,audience,author_id,title,parent_id,occurred_on,amount_kopecks,origin_space_id,origin_space_kind,origin_audience) VALUES($1,$2,$3,$4,'Событие',$5,'2026-10-07',12345,$1,$2,$3)`,
    [spaceId, kind, audience, person.id, object],
  );
  await world.database.admin.query(
    `INSERT INTO note_files(id,space_id,space_kind,audience,author_id,title,parent_id,mime_type,size_bytes,storage_key,envelope) VALUES($1,$2,$3,$4,$5,'../Файл.pdf',$6,'application/pdf',$7,$8,$9)`,
    [file, spaceId, kind, audience, person.id, note, payload.length, key, sealed.envelope],
  );
  if (kind === 'personal') {
    const photoKey = randomUUID();
    const photoBlock = cipher.seal(payload, photoKey);
    await storage.put(photoKey, photoBlock.block);
    await world.database.admin.query(
      `INSERT INTO profile_files(id,account_id,title,mime_type,size_bytes,storage_key,envelope) VALUES($1,$2,'Снятое фото.jpg','image/jpeg',$3,$4,$5)`,
      [photo, person.id, payload.length, photoKey, photoBlock.envelope],
    );
    await world.database.admin.query('UPDATE profile_files SET deleted_at=now() WHERE id=$1', [
      photo,
    ]);
  }
  await world.module.appDb.withAccount(person.id, (tx) =>
    tx.execute(sql`INSERT INTO deadlines(note_id,household_id,space_id,space_kind,audience,author_id,assignee_id,rule)
    VALUES(${note}::uuid,${world.houseId}::uuid,${spaceId}::uuid,${kind},${audience},${person.id}::uuid,${person.id}::uuid,
      ${JSON.stringify({ kind: 'date', date: '2026-10-20', time: '00:00', durationDays: 0, warnings: [] })}::jsonb)`),
  );
  return { note, object, file, photo };
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-export-fixtures-'));
  storage = new DirectoryStorage(folder);
  cipher = new FileCipher(randomBytes(32), 1);
  world = await createWorld({ files: { storage, cipher } });
  adult = world.device();
  child = world.device();
  expect((await adult.signIn(world.boris.username, world.boris.password)).status).toBe(200);
  expect((await child.signIn(world.vera.username, world.vera.password)).status).toBe(200);
  admin = (await signedInAdmin(world)).device;
  for (const person of [world.anna, world.boris, world.vera])
    ids.set(person.key, await seed(person, person.personalSpaceId, 'personal', null));
  ids.set('family', await seed(world.boris, world.houseId, 'household', 'household'));
  ids.set('adults', await seed(world.boris, world.houseId, 'household', 'adults'));
  await world.database.admin.query('UPDATE notes SET deleted_at=now() WHERE id=$1', [
    ids.get('vera')?.note,
  ]);
});
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});

it.each(['anna', 'boris', 'vera'] as const)(
  'DATA-2: личный ZIP %s — точный состав, корзина и хеши файлов',
  async (key) => {
    const person = world[key];
    const response = await archive(
      key === 'anna' ? admin : key === 'boris' ? adult : child,
      person.password,
    );
    expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const entries = await unpack(response.rawPayload);
    const manifest = ExportManifest.parse(json(entries, 'manifest'));
    expect(manifest.scope).toEqual({ kind: 'personal' });
    for (const [name, count] of Object.entries(manifest.counts)) {
      expect(json(entries, name)).toHaveLength(count);
      if (name in ExportRecords)
        for (const row of json(entries, name))
          ExportRecords[name as keyof typeof ExportRecords].parse(row);
    }
    expect(json(entries, 'notes').map((n: { id: string }) => n.id)).toEqual([ids.get(key)?.note]);
    expect(json(entries, 'objects').map((n: { id: string }) => n.id)).toEqual([
      ids.get(key)?.object,
    ]);
    for (const name of [
      'note_items',
      'object_fields',
      'object_events',
      'deadlines',
      'note_files',
      'profile_files',
    ])
      expect(json(entries, name)).toHaveLength(1);
    expect(json(entries, 'object_events')[0].amount_kopecks).toBe(12345);
    expect(json(entries, 'object_events')[0].occurred_on).toBe('2026-10-07');
    expect(json(entries, 'profile')[0].account_id).toBe(person.id);
    for (const name of ['note_files', 'profile_files']) {
      const file = json(entries, name)[0];
      expect(hash(entries.get(file.archive_path) ?? Buffer.alloc(0))).toBe(hash(payload));
      expect(file.archive_path).not.toContain('/../');
    }
    const metadata = [...entries]
      .filter(([name]) => name.endsWith('.json'))
      .map(([, data]) => data.toString())
      .join('');
    expect(metadata).not.toMatch(/storage_key|envelope|wrappedKey|password|session_token/);
    expect(metadata).not.toContain(ids.get(key === 'anna' ? 'boris' : 'anna')?.note);
    if (key === 'vera') {
      expect(json(entries, 'notes')[0].deleted_at).not.toBeNull();
      expect(json(entries, 'note_files')[0].deleted_at).not.toBeNull();
    }
  },
);
it('DATA-2: общее дома — обе аудитории, состав без чужих профилей и личного', async () => {
  const response = await archive(admin, world.anna.password, {
    kind: 'household',
    householdId: world.houseId,
  });
  expect(response.statusCode, response.body).toBe(200);
  const entries = await unpack(response.rawPayload);
  expect(
    json(entries, 'notes')
      .map((n: { id: string }) => n.id)
      .sort(),
  ).toEqual([ids.get('family')?.note, ids.get('adults')?.note].sort());
  expect(json(entries, 'members')).toHaveLength(3);
  expect(entries.has('profile.json')).toBe(false);
  expect(json(entries, 'profile_files')).toEqual([]);
  const metadata = [...entries]
    .filter(([name]) => name.endsWith('.json'))
    .map(([, data]) => data.toString())
    .join('');
  for (const key of ['anna', 'boris', 'vera']) expect(metadata).not.toContain(ids.get(key)?.note);
  expect(metadata).not.toMatch(/password|email|username|envelope/);
});
it('DATA-2: запреты роли, неверный пароль, Origin, подтверждение и отозванная сессия', async () => {
  for (const device of [adult, child])
    expect(
      (
        await archive(device, world.boris.password, {
          kind: 'household',
          householdId: world.houseId,
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (await archive(admin, world.anna.password, { kind: 'household', householdId: randomUUID() }))
      .statusCode,
  ).toBe(403);
  expect((await archive(adult, 'wrong')).statusCode).toBe(403);
  expect(
    (
      await adult.post('/api/export/archive', {
        scope: { kind: 'personal' },
        password: world.boris.password,
        confirmed: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await adult.post(
        '/api/export/archive',
        { scope: { kind: 'personal' }, password: world.boris.password, confirmed: true },
        { origin: 'https://foreign.invalid' },
      )
    ).status,
  ).toBe(403);
  const stranger = world.device();
  expect((await archive(stranger, world.boris.password)).statusCode).toBe(401);
  expect(world.requestLog.join('\n')).not.toContain('fictional export original');
});
it('DATA-2: скрытый контакт и прежние личные события не раскрываются через общий архив и историю', async () => {
  const event = await adult.post(`/api/objects/${ids.get('family')?.object}/events`, {
    text: 'Скрытый контакт',
    occurredOn: '2026-10-07',
    contact: { type: 'note', id: ids.get('boris')?.note },
  });
  expect(event.status, event.text).toBe(201);
  const hiddenEvent = await admin.post(`/api/objects/${ids.get('anna')?.object}/events`, {
    text: 'Личная история до открытия',
    occurredOn: '2026-10-07',
  });
  expect(hiddenEvent.status, hiddenEvent.text).toBe(201);
  const hiddenId = hiddenEvent.json<{ id: string }>().id;
  const share = await admin.post(`/api/objects/${ids.get('anna')?.object}/share`, {
    spaceId: world.houseId,
    audience: 'household',
  });
  expect(share.status, share.text).toBe(200);
  // После переноса правка личного события всё равно не делает его общей историей.
  expect(
    (
      await admin.request('PATCH', `/api/objects/${ids.get('anna')?.object}/events/${hiddenId}`, {
        json: { text: 'Личная история после открытия' },
      })
    ).status,
  ).toBe(200);
  const response = await archive(admin, world.anna.password, {
    kind: 'household',
    householdId: world.houseId,
  });
  expect(response.statusCode, response.body).toBe(200);
  const entries = await unpack(response.rawPayload);
  const exportedEvent = json(entries, 'object_events').find(
    (row: { id: string }) => row.id === event.json<{ id: string }>().id,
  );
  expect(exportedEvent.contact).toBeNull();
  const metadata = [...entries]
    .filter(([name]) => name.endsWith('.json'))
    .map(([, data]) => data.toString())
    .join('');
  expect(metadata).not.toContain(ids.get('boris')?.note);
  expect(metadata).not.toContain(hiddenId);
  expect(metadata).not.toContain('Личная история');
});

it('DATA-2: неверный пароль блокируется как вход, запросы ограничены, отзыв сессии действует сразу', async () => {
  await world.database.admin.query('DELETE FROM login_locks WHERE account_id=$1', [world.boris.id]);
  try {
    for (let i = 0; i < 5; i++) expect((await archive(adult, 'wrong')).statusCode).toBe(403);
    expect((await archive(adult, world.boris.password)).statusCode).toBe(429);
  } finally {
    await world.database.admin.query('DELETE FROM login_locks WHERE account_id=$1', [
      world.boris.id,
    ]);
  }
  await world.database.admin.query(
    'INSERT INTO rate_limits(key,count,last_request) VALUES($1,120,$2) ON CONFLICT(key) DO UPDATE SET count=120,last_request=$2',
    [`export:${adult.ip}:${world.boris.id}`, Date.now()],
  );
  expect((await archive(adult, world.boris.password)).statusCode).toBe(429);
  await world.clearRateLimits();
  const revoked = world.device();
  expect((await revoked.signIn(world.boris.username, world.boris.password)).status).toBe(200);
  expect((await revoked.post('/api/auth/sign-out')).status).toBe(200);
  expect((await archive(revoked, world.boris.password)).statusCode).toBe(401);
});

it('DATA-2: ошибка дешифрования не отдаёт архив, не пишет успех и удаляет временный ZIP', async () => {
  const before = new Set(await readdir(tmpdir()));
  const beforeHistory = (await adult.get('/api/export/history')).json<unknown[]>();
  const result = await world.database.admin.query<{ storage_key: string }>(
    'SELECT storage_key FROM note_files WHERE id=$1',
    [ids.get('boris')?.file],
  );
  const key = result.rows[0]?.storage_key;
  if (!key) throw new Error('Missing fictional file');
  const original = await storage.get(key);
  await storage.delete(key);
  await storage.put(key, Buffer.alloc(30));
  try {
    const failed = await archive(adult, world.boris.password);
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ code: 'EXPORT_FAILED' });
    expect((await adult.get('/api/export/history')).json()).toEqual(beforeHistory);
    expect(
      (await readdir(tmpdir())).filter(
        (dir) => dir.startsWith('homecrm-export-') && !before.has(dir),
      ),
    ).toEqual([]);
  } finally {
    await storage.delete(key);
    await storage.put(key, original);
  }
  const log = world.requestLog.join('\n');
  for (const secret of [
    '**Markdown**',
    '../Файл.pdf',
    'Скрытый контакт',
    world.boris.password,
    world.secret,
  ])
    expect(log).not.toContain(secret);
});

it('DATA-2: 1000 записей и 50 файлов — страницы и последовательная запись на диск', async () => {
  const data = randomBytes(256 * 1024);
  await world.database.admin.query(
    `INSERT INTO notes(space_id,space_kind,author_id,title) SELECT $1,'personal',$2,'Массовая запись '||i FROM generate_series(1,1000) i`,
    [world.boris.personalSpaceId, world.boris.id],
  );
  for (let i = 0; i < 50; i++) {
    const key = randomUUID();
    const sealed = cipher.seal(data, key);
    await storage.put(key, sealed.block);
    await world.database.admin.query(
      `INSERT INTO note_files(space_id,space_kind,author_id,title,parent_id,mime_type,size_bytes,storage_key,envelope) VALUES($1,'personal',$2,'Массовый файл',$3,'application/pdf',$4,$5,$6)`,
      [
        world.boris.personalSpaceId,
        world.boris.id,
        ids.get('boris')?.note,
        data.length,
        key,
        sealed.envelope,
      ],
    );
  }
  let active = 0;
  let maximum = 0;
  let reads = 0;
  let progressed = false;
  const tracked = {
    ...storage,
    get: async (key: string) => {
      active++;
      maximum = Math.max(maximum, active);
      reads++;
      try {
        if (reads > 2)
          for (const dir of await readdir(tmpdir()))
            if (dir.startsWith('homecrm-export-') && !dir.startsWith('homecrm-export-fixtures-')) {
              try {
                if ((await stat(join(tmpdir(), dir, 'export.zip'))).size > 0) progressed = true;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              }
            }
        return await storage.get(key);
      } finally {
        active--;
      }
    },
    put: storage.put.bind(storage),
    delete: storage.delete.bind(storage),
    olderThan: storage.olderThan.bind(storage),
  };
  const account = {
    id: world.boris.id,
    sessionId: 'test',
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
  const result = await createAppDatabase(world.database.app).withAccount(
    account.id,
    (tx) =>
      buildArchive(
        tx,
        account,
        { kind: 'personal' },
        { storage: tracked, cipher },
        world.module.homeTimeZone,
        new AbortController().signal,
      ),
    { isolationLevel: 'repeatable read' },
  );
  try {
    expect(result.manifest.counts.notes).toBe(1001);
    expect(result.manifest.counts.note_files).toBe(51);
    expect(maximum).toBe(1);
    expect(reads).toBe(52);
    expect(progressed).toBe(true);
    const entries = await unpack(result.path);
    expect(json(entries, 'notes')).toHaveLength(1001);
    for (const file of json(entries, 'note_files').filter(
      (f: { title: string }) => f.title === 'Массовый файл',
    ))
      expect(hash(entries.get(file.archive_path) ?? Buffer.alloc(0))).toBe(hash(data));
  } finally {
    await result.cleanup();
  }
});
