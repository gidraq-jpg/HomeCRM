import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppDatabase, sql } from '@homecrm/db';
import { ExportManifest, ExportRecords, type ExportScope } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { fromBuffer, open, type ZipFile } from 'yauzl';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import * as references from '../objects/support.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { enrollTotp, signedInAdmin } from '../testing/flows.ts';
import { createWorld, type Person, type World } from '../testing/world.ts';
import { buildArchive, EXPORT_TEMP_PREFIX } from './archive.ts';

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
  instance: World = world,
) {
  return instance.app.inject({
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
  const provider = randomUUID();
  await world.database.admin.query(
    `INSERT INTO contacts(id,space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,$5,'Вымышленный поставщик')`,
    [provider, spaceId, kind, audience, person.id],
  );
  await world.database.admin.query(
    `INSERT INTO objects(id,space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,$5,'Объект')`,
    [object, spaceId, kind, audience, person.id],
  );
  const financialAccount = await world.database.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,supplier_id) VALUES($1,$2,$3,$4,'Лицевой счёт',$5,$6) RETURNING id`,
    [spaceId, kind, audience, person.id, object, provider],
  );
  const financialCharge = await world.database.admin.query(
    `INSERT INTO utility_charges(space_id,space_kind,audience,author_id,title,parent_id,period,total_cents,due_on) VALUES($1,$2,$3,$4,'Начисление',$5,'2026-10',12345,'2026-11-15') RETURNING id`,
    [spaceId, kind, audience, person.id, financialAccount.rows[0].id],
  );
  const financialPayment = await world.database.admin.query(
    `INSERT INTO utility_payments(space_id,space_kind,audience,author_id,title,parent_id,paid_on,amount_cents,payer,method) VALUES($1,$2,$3,$4,'Оплата',$5,'2026-10-08',12345,'{"kind":"tenant"}','tenant') RETURNING id`,
    [spaceId, kind, audience, person.id, financialCharge.rows[0].id],
  );
  await world.database.admin.query(
    "UPDATE utility_payments SET cancelled_at=now(),cancellation_reason='Вымышленная отмена' WHERE id=$1",
    [financialPayment.rows[0].id],
  );
  const meter = await world.database.admin.query(
    `INSERT INTO meters(space_id,space_kind,audience,author_id,title,parent_id,data) VALUES($1,$2,$3,$4,'Вымышленный счётчик',$5,'{"resource":"cold_water","integerDigits":12,"fractionDigits":6,"zones":["Основная"]}') RETURNING id`,
    [spaceId, kind, audience, person.id, object],
  );
  await world.database.admin.query(
    `INSERT INTO meter_readings(space_id,space_kind,audience,author_id,title,parent_id,occurred_on,values,consumption) VALUES($1,$2,$3,$4,'Показание',$5,'2026-10-01',ARRAY[999999999999.123456]::numeric[],ARRAY[0.000001]::numeric[])`,
    [spaceId, kind, audience, person.id, meter.rows[0].id],
  );
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
      'contacts',
      'utility_accounts',
      'utility_charges',
      'utility_payments',
      'meters',
      'meter_readings',
      'object_fields',
      'object_events',
      'note_files',
      'profile_files',
    ])
      expect(json(entries, name)).toHaveLength(1);
    expect(json(entries, 'deadlines')).toHaveLength(2);
    expect(JSON.stringify(json(entries, 'history'))).toContain('Вымышленная отмена');
    expect(json(entries, 'object_events')[0].amount_kopecks).toBe(12345);
    expect(json(entries, 'meter_readings')[0].values).toEqual(['999999999999.123456']);
    expect(json(entries, 'meter_readings')[0].consumption).toEqual(['0.000001']);
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
  expect(json(entries, 'contacts')).toHaveLength(2);
  expect(json(entries, 'utility_accounts')).toHaveLength(2);
  expect(json(entries, 'utility_charges')).toHaveLength(2);
  expect(json(entries, 'utility_payments')).toHaveLength(2);
  expect(json(entries, 'meters')).toHaveLength(2);
  expect(json(entries, 'meter_readings')).toHaveLength(2);
  const meterHistory = json(entries, 'history').filter(
    (h: { table: string }) => h.table === 'meter_readings',
  );
  expect(meterHistory.length).toBeGreaterThan(0);
  expect(JSON.stringify(meterHistory)).toContain('"999999999999.123456"');
  for (const row of json(entries, 'utility_accounts'))
    expect(json(entries, 'contacts').some((c: { id: string }) => c.id === row.supplier_id)).toBe(
      true,
    );
  expect(entries.has('profile.json')).toBe(false);
  expect(json(entries, 'profile_files')).toEqual([]);
  const metadata = [...entries]
    .filter(([name]) => name.endsWith('.json'))
    .map(([, data]) => data.toString())
    .join('');
  for (const key of ['anna', 'boris', 'vera']) expect(metadata).not.toContain(ids.get(key)?.note);
  expect(metadata).not.toMatch(/password|email|username|envelope/);
});
it('UTIL-2: ZIP сохраняет счета в корзине и скрывает личного поставщика, включая историю', async () => {
  const contact = await adult.post('/api/contacts', {
    title: 'Личный поставщик Вымышленный',
    placement: { spaceId: world.boris.personalSpaceId },
  });
  expect(contact.status, contact.text).toBe(201);
  const supplierId = contact.json<{ id: string }>().id;
  const property = await adult.post('/api/objects', {
    title: 'Вымышленная квартира для архива',
    objectType: 'property',
    placement: { spaceId: world.houseId, audience: 'adults' },
    typeData: { areaHundredths: 5731 },
  });
  expect(property.status, property.text).toBe(201);
  const parentId = property.json<{ id: string }>().id;
  const account = await adult.post(`/api/objects/${parentId}/accounts`, {
    supplierId,
    data: { number: 'ARCHIVE-123' },
  });
  expect(account.status, account.text).toBe(201);
  const accountId = account.json<{ id: string }>().id;
  expect((await adult.post(`/api/objects/${parentId}/trash`)).status).toBe(200);
  const response = await archive(admin, world.anna.password, {
    kind: 'household',
    householdId: world.houseId,
  });
  expect(response.statusCode, response.body).toBe(200);
  const entries = await unpack(response.rawPayload);
  const saved = json(entries, 'utility_accounts').find(
    (row: { id: string }) => row.id === accountId,
  );
  expect(saved).toMatchObject({ supplier_id: null, data: { number: 'ARCHIVE-123' } });
  expect(saved.deleted_at).not.toBeNull();
  expect(
    json(entries, 'objects').find((row: { id: string }) => row.id === parentId).type_data,
  ).toEqual({ areaHundredths: 5731 });
  const metadata = [...entries]
    .filter(([name]) => name.endsWith('.json'))
    .map(([, data]) => data.toString())
    .join('');
  expect(metadata).not.toContain(supplierId);
  expect(metadata).not.toContain('Личный поставщик Вымышленный');
  const personalResponse = await archive(adult, world.boris.password);
  expect(personalResponse.statusCode, personalResponse.body).toBe(200);
  const personal = await unpack(personalResponse.rawPayload);
  expect(json(personal, 'contacts').some((row: { id: string }) => row.id === supplierId)).toBe(
    true,
  );
  expect(
    json(personal, 'utility_accounts').some((row: { id: string }) => row.id === accountId),
  ).toBe(false);
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
  const concurrent = await mkdtemp(join(tmpdir(), 'homecrm-export-other-process-'));
  try {
    const failed = await archive(adult, world.boris.password);
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ code: 'EXPORT_FAILED' });
    expect((await adult.get('/api/export/history')).json()).toEqual(beforeHistory);
    expect(
      (await readdir(tmpdir())).filter(
        (dir) => dir.startsWith(EXPORT_TEMP_PREFIX) && !before.has(dir),
      ),
    ).toEqual([]);
    expect((await stat(concurrent)).isDirectory()).toBe(true);
  } finally {
    await rm(concurrent, { recursive: true, force: true });
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
            if (dir.startsWith(EXPORT_TEMP_PREFIX)) {
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

it.each(['personal', 'adults'] as const)(
  'DATA-2: связь с событием из %s после открытия объекта не срывает экспорт',
  async (origin) => {
    const instance = await createWorld();
    const originalRead = references.readReference;
    const read = vi.spyOn(references, 'readReference');
    try {
      const owner = (await signedInAdmin(instance)).device;
      const boris = instance.device();
      const vera = instance.device();
      expect((await boris.signIn(instance.boris.username, instance.boris.password)).status).toBe(
        200,
      );
      expect((await vera.signIn(instance.vera.username, instance.vera.password)).status).toBe(200);
      const common = await owner.post('/api/notes', {
        title: 'Общая заметка',
        placement: { spaceId: instance.houseId, audience: 'household' },
      });
      expect(common.status, common.text).toBe(201);
      const commonId = common.json<{ id: string }>().id;
      const object = await owner.post('/api/objects', {
        title: 'Объект с прежним событием',
        ...(origin === 'adults'
          ? { placement: { spaceId: instance.houseId, audience: 'adults' } }
          : {}),
      });
      expect(object.status, object.text).toBe(201);
      const objectId = object.json<{ id: string }>().id;
      const event = await owner.post(`/api/objects/${objectId}/events`, {
        text: 'Прежнее событие',
        occurredOn: '2026-10-07',
      });
      expect(event.status, event.text).toBe(201);
      const eventId = event.json<{ id: string }>().id;
      const opened = await owner.post(
        `/api/objects/${objectId}/${origin === 'personal' ? 'share' : 'audience'}`,
        { ...(origin === 'personal' ? { spaceId: instance.houseId } : {}), audience: 'household' },
      );
      expect(opened.status, opened.text).toBe(200);
      const eventRef = { type: 'object_event', id: eventId };
      const noteRef = { type: 'note', id: commonId };
      const hiddenLink = await owner.post('/api/links', {
        left: origin === 'personal' ? eventRef : noteRef,
        right: origin === 'personal' ? noteRef : eventRef,
      });
      expect(hiddenLink.status, hiddenLink.text).toBe(201);
      const hiddenLinkId = hiddenLink.json<{ id: string }>().id;
      const visibleLink = await owner.post('/api/links', {
        left: { type: 'note', id: commonId },
        right: { type: 'object', id: objectId },
      });
      expect(visibleLink.status, visibleLink.text).toBe(201);
      const visibleLinkId = visibleLink.json<{ id: string }>().id;
      for (const [device, person] of [
        [boris, instance.boris],
        [vera, instance.vera],
      ] as const) {
        const note = await device.post('/api/notes', { title: 'Моя личная заметка' });
        expect(note.status, note.text).toBe(201);
        const noteId = note.json<{ id: string }>().id;
        const personalLink = await device.post('/api/links', {
          left: { type: 'note', id: origin === 'personal' ? noteId : commonId },
          right: { type: 'note', id: origin === 'personal' ? commonId : noteId },
        });
        expect(personalLink.status, personalLink.text).toBe(201);
        read.mockClear();
        const response = await archive(device, person.password, { kind: 'personal' }, instance);
        expect(read.mock.calls.some(([, , ref]) => ref.id === eventId)).toBe(false);
        expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
        const entries = await unpack(response.rawPayload);
        expect(json(entries, 'notes').map((row: { id: string }) => row.id)).toEqual([noteId]);
        expect(json(entries, 'object_events')).toEqual([]);
        expect(json(entries, 'record_links').map((row: { id: string }) => row.id)).toEqual([
          personalLink.json<{ id: string }>().id,
        ]);
      }
      // Другой администратор не получает личное происхождение события Анны.
      await instance.database.admin.query(
        "UPDATE space_members SET role='admin' WHERE space_id=$1 AND account_id=$2",
        [instance.houseId, instance.boris.id],
      );
      await enrollTotp(boris, instance.boris);
      const response = await archive(
        boris,
        instance.boris.password,
        { kind: 'household', householdId: instance.houseId },
        instance,
      );
      expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
      const entries = await unpack(response.rawPayload);
      expect(
        json(entries, 'record_links')
          .map((row: { id: string }) => row.id)
          .sort(),
      ).toEqual((origin === 'personal' ? [visibleLinkId] : [visibleLinkId, hiddenLinkId]).sort());
      expect(json(entries, 'object_events').map((row: { id: string }) => row.id)).toEqual(
        origin === 'personal' ? [] : [eventId],
      );
      // RLS уже скрывает такие связи; отдельно проверяем отказ проверки конца в коде приложения.
      read.mockImplementation(async (tx, account, ref) => {
        if (ref.id === eventId) throw new references.Failure(404, 'NOT_FOUND');
        return originalRead(tx, account, ref);
      });
      const unavailable = await archive(
        owner,
        instance.anna.password,
        { kind: 'household', householdId: instance.houseId },
        instance,
      );
      expect(unavailable.statusCode, unavailable.body.slice(0, 200)).toBe(200);
      expect(
        json(await unpack(unavailable.rawPayload), 'record_links').map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual([visibleLinkId]);
    } finally {
      read.mockRestore();
      await instance.close();
    }
  },
);

it('DOC-1/5: архив содержит версии документов, историю и расшифрованные страницы; чужое личное скрыто', async () => {
  const oldResponse = await adult.post('/api/documents', {
    title: 'Вымышленный договор экспорта',
    data: { type: 'contract', number: 'EXPORT-FAKE-001', expiresOn: '2026-12-01' },
  });
  expect(oldResponse.status, oldResponse.text).toBe(201);
  const old = oldResponse.json<{ id: string }>();
  const renewed = await adult.post(`/api/documents/${old.id}/renew`, {
    data: { type: 'contract', number: 'EXPORT-FAKE-002', indefinite: true },
  });
  expect(renewed.status, renewed.text).toBe(201);
  const current = renewed.json<{ id: string }>();
  const key = randomUUID(),
    file = randomUUID();
  const sealed = cipher.seal(payload, key);
  await storage.put(key, sealed.block);
  await world.database.admin.query(
    `INSERT INTO document_files(id,parent_id,space_id,space_kind,author_id,title,mime_type,size_bytes,storage_key,envelope)
    VALUES($1,$2,$3,'personal',$4,'Вымышленная страница.pdf','application/pdf',$5,$6,$7)`,
    [
      file,
      current.id,
      world.boris.personalSpaceId,
      world.boris.id,
      payload.length,
      key,
      sealed.envelope,
    ],
  );
  const response = await archive(adult, world.boris.password);
  expect(response.statusCode, response.body).toBe(200);
  const entries = await unpack(response.rawPayload);
  expect(json(entries, 'documents')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: old.id,
        status: 'invalid',
        data: expect.objectContaining({ number: 'EXPORT-FAKE-001' }),
      }),
      expect.objectContaining({ id: current.id, previous_id: old.id }),
    ]),
  );
  expect(json(entries, 'history')).toEqual(
    expect.arrayContaining([expect.objectContaining({ table: 'documents', record_id: old.id })]),
  );
  const metadata = json(entries, 'document_files').find((row: { id: string }) => row.id === file);
  expect(entries.get(metadata.archive_path)).toEqual(payload);
  const other = await unpack((await archive(admin, world.anna.password)).rawPayload);
  expect(json(other, 'documents')).toEqual([]);
  expect(json(other, 'document_files')).toEqual([]);
});
