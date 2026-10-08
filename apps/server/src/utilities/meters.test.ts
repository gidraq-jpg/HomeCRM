import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { redactUrl } from '../logging.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let child: Device;
let admin: Device;
interface Reading {
  id: string;
  parentId: string;
  values: string[];
  consumption: string[] | null;
  warnings: string[];
  photoIds: string[];
  transmissionStatus: string;
  deletedAt: string | null;
  occurredOn: string;
}
interface Meter {
  id: string;
  parentId: string;
  data: Record<string, unknown>;
  previousMeterId: string | null;
  initialReading: Reading | null;
  previousReading: Reading | null;
  deletedAt: string | null;
}
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
async function object(device = adult, personal = false) {
  const res = await device.post('/api/objects', {
    title: 'Вымышленная квартира показаний',
    objectType: 'property',
    placement: {
      spaceId: personal ? world.boris.personalSpaceId : world.houseId,
      ...(personal ? {} : { audience: 'adults' }),
    },
  });
  expect(res.status, res.text).toBe(201);
  return res.json<{ id: string }>().id;
}
async function meter(
  parent: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
  device = adult,
) {
  const res = await device.post(`/api/objects/${parent}/meters`, {
    data: { resource: 'cold_water', ...data },
    ...extra,
  });
  expect(res.status, res.text).toBe(201);
  return res.json<Meter>();
}
async function reading(
  id: string,
  date: string,
  values: string[],
  extra: Record<string, unknown> = {},
) {
  const res = await adult.post(`/api/meters/${id}/readings`, {
    occurredOn: date,
    values,
    ...extra,
  });
  expect(res.status, res.text).toBe(201);
  return res.json<Reading>();
}
async function history(id: string) {
  return (await adult.get(`/api/meters/${id}/readings`)).json<Reading[]>();
}
it('UTIL-14: ресурс и одно последнее показание достаточны, поверка вычисляется и правится', async () => {
  const id = await object();
  const row = await meter(
    id,
    { verifiedOn: '2020-10-08' },
    { initialReading: { occurredOn: '2026-10-01', values: ['123,456'] } },
  );
  expect(row.data.nextVerificationOn).toBe('2026-10-08');
  expect(row.initialReading?.consumption).toBeNull();
  expect(row.initialReading?.warnings).toEqual([]);
  const res = await adult.request('PATCH', `/api/meters/${row.id}`, {
    json: { data: { ...row.data, nextVerificationOn: '2027-03-01' } },
  });
  expect(res.status, res.text).toBe(200);
  expect(res.json<Meter>().data.nextVerificationOn).toBe('2027-03-01');
});
it('UTIL-5: меньшее значение отклоняется; явный переход через ноль и три зоны точны', async () => {
  const id = await object();
  const row = await meter(id, {
    resource: 'electricity',
    integerDigits: 3,
    fractionDigits: 2,
    zones: ['День', 'Ночь', 'Пик'],
  });
  await reading(row.id, '2026-09-01', ['999.99', '100.00', '200.00']);
  const bad = await adult.post(`/api/meters/${row.id}/readings`, {
    occurredOn: '2026-10-01',
    values: ['0.01', '110.00', '205.00'],
  });
  expect(bad.status).toBe(400);
  expect(await history(row.id)).toHaveLength(1);
  expect(
    (await reading(row.id, '2026-10-01', ['0.01', '110.00', '205.00'], { rollover: true }))
      .consumption,
  ).toEqual(['0.02', '10.00', '5.00']);
  const shape = await adult.request('PATCH', `/api/meters/${row.id}`, {
    json: { data: { ...row.data, fractionDigits: 3 } },
  });
  expect(shape.status).toBe(409);
});
it('UTIL-5: ровно 40% за шесть месяцев и при меньшей истории, старая история исключена', async () => {
  const id = await object();
  const row = await meter(id, { fractionDigits: 3 });
  for (let month = 1; month <= 7; month++)
    await reading(row.id, `2026-${String(month).padStart(2, '0')}-01`, [String(month - 1)]);
  expect((await reading(row.id, '2026-08-01', ['7.4'])).warnings).toEqual([
    'Проверьте, нет ли утечки или ошибки',
  ]);
  const short = await meter(id);
  await reading(short.id, '2026-07-01', ['0']);
  await reading(short.id, '2026-08-01', ['1']);
  expect((await reading(short.id, '2026-09-01', ['2.4'])).warnings).toHaveLength(1);
  const stale = await meter(id);
  await reading(stale.id, '2025-01-01', ['0']);
  await reading(stale.id, '2025-02-01', ['1']);
  expect((await reading(stale.id, '2026-10-01', ['100'])).warnings).toEqual([]);
});
it('S3: четыре счётчика одним вводом, группировка по счетам и одна передача', async () => {
  const id = await object();
  const account = await adult.post(`/api/objects/${id}/accounts`, {
    data: {
      number: 'FICTION-001',
      transmission: { method: 'provider', url: 'https://fictional.invalid' },
    },
  });
  expect(account.status, account.text).toBe(201);
  const rows = [];
  for (let i = 0; i < 4; i++)
    rows.push(
      await meter(
        id,
        { installationPlace: `Санузел ${i}` },
        {
          utilityAccountId: account.json<{ id: string }>().id,
          initialReading: { occurredOn: '2026-09-01', values: ['100'] },
        },
      ),
    );
  const listed = (await adult.get(`/api/objects/${id}/meters`)).json<Meter[]>();
  expect(listed).toHaveLength(4);
  expect(listed.every((r) => r.previousReading?.values[0] === '100.000')).toBe(true);
  const save = await adult.post(`/api/objects/${id}/readings`, {
    readings: rows.map((r) => ({ meterId: r.id, occurredOn: '2026-10-01', values: ['110'] })),
  });
  expect(save.status, save.text).toBe(201);
  expect(save.json<Reading[]>().every((r) => r.consumption?.[0] === '10.000')).toBe(true);
  const groups = (await adult.get(`/api/objects/${id}/transmission`)).json<
    { number: string; transmission: unknown; readings: Reading[] }[]
  >();
  expect(groups).toHaveLength(1);
  expect(groups[0]?.readings).toHaveLength(4);
  expect(groups[0]?.number).toBe('FICTION-001');
  const transmit = await adult.post(`/api/objects/${id}/readings/transmit`, {
    readingIds: save.json<Reading[]>().map((r) => r.id),
    method: 'Сайт поставщика',
  });
  expect(transmit.status, transmit.text).toBe(200);
  expect(transmit.json<Reading[]>().every((r) => r.transmissionStatus === 'transmitted')).toBe(
    true,
  );
  const again = await adult.post(`/api/objects/${id}/readings/transmit`, {
    readingIds: save.json<Reading[]>().map((r) => r.id),
    method: 'Повтор',
  });
  expect(again.status, again.text).toBe(200);
  expect(again.json()).toEqual(transmit.json());
  expect((await adult.get(`/api/objects/${id}/transmission`)).json()).toEqual([]);
  const feed = await adult.get(`/api/objects/${id}/timeline`);
  expect(feed.status, feed.text).toBe(200);
  expect(feed.text).toContain('reading');
});
it('пакетный ввод и передача откатываются целиком, повторные даты и гонка не дублируют показания', async () => {
  const id = await object();
  const rows = [await meter(id), await meter(id)] as const;
  for (const r of rows) await reading(r.id, '2026-09-01', ['100']);
  const batch = await adult.post(`/api/objects/${id}/readings`, {
    readings: rows.map((r, i) => ({
      meterId: r.id,
      occurredOn: '2026-10-01',
      values: [i ? '90' : '110'],
    })),
  });
  expect(batch.status).toBe(400);
  for (const r of rows) expect(await history(r.id)).toHaveLength(1);
  const saved = await reading(rows[0].id, '2026-10-01', ['110']);
  const failed = await adult.post(`/api/objects/${id}/readings/transmit`, {
    readingIds: [saved.id, randomUUID()],
    method: 'Сайт',
  });
  expect(failed.status).toBe(404);
  expect((await history(rows[0].id)).at(-1)?.transmissionStatus).toBe('pending');
  const attempts = await Promise.all(
    [1, 2].map(() =>
      adult.post(`/api/meters/${rows[0].id}/readings`, {
        occurredOn: '2026-11-01',
        values: ['120'],
      }),
    ),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await history(rows[0].id)).toHaveLength(3);
});
it('UTIL-6: замена атомарна, итоговый и начальный отсчёт сохраняют непрерывный расход', async () => {
  const id = await object();
  const old = await meter(id);
  await reading(old.id, '2026-09-01', ['100']);
  const body = {
    finalReading: { occurredOn: '2026-10-01', values: ['110'] },
    newMeter: {
      data: { resource: 'cold_water' },
      initialReading: { occurredOn: '2026-10-01', values: ['0'] },
    },
  };
  const failed = await adult.post(`/api/meters/${old.id}/replace`, {
    ...body,
    newMeter: { ...body.newMeter, utilityAccountId: randomUUID() },
  });
  expect(failed.status).toBe(404);
  expect(await history(old.id)).toHaveLength(1);
  expect((await adult.get(`/api/meters/${old.id}`)).json<Meter>().data.status).toBe('active');
  const replaced = await adult.post(`/api/meters/${old.id}/replace`, body);
  expect(replaced.status, replaced.text).toBe(201);
  const next = replaced.json<{ newMeter: Meter; finalReading: Reading }>();
  expect(next.finalReading.consumption).toEqual(['10.000']);
  expect(next.newMeter.previousMeterId).toBe(old.id);
  await reading(next.newMeter.id, '2026-11-01', ['7']);
  const chain = (
    await adult.get(`/api/meters/${next.newMeter.id}/readings?includePrevious=true`)
  ).json<Reading[]>();
  expect(chain.map((r) => r.consumption)).toEqual([null, ['10.000'], null, ['7.000']]);
  expect(
    (
      await adult.post(`/api/meters/${old.id}/readings`, {
        occurredOn: '2026-11-01',
        values: ['120'],
      })
    ).status,
  ).toBe(409);
});
it('ребёнок не видит «Взрослые» через API, поиск, передачу и ленту', async () => {
  const id = await object();
  const row = await meter(id, { serialNumber: 'FICTION-SECRET-918273' });
  await reading(row.id, '2026-10-01', ['1']);
  for (const path of [
    `/api/meters/${row.id}`,
    `/api/meters/${row.id}/readings`,
    `/api/objects/${id}/meters`,
    `/api/objects/${id}/transmission`,
    `/api/objects/${id}/timeline`,
  ])
    expect((await child.get(path)).status, path).toBe(404);
  const search = await adult.get('/api/search?q=918273');
  expect(search.text).toContain(row.id);
  const hidden = await child.get('/api/search?q=918273');
  expect(hidden.text).not.toContain(row.id);
  expect(hidden.text).not.toContain('918273');
  const personal = await object(adult, true);
  const own = await meter(personal);
  expect((await admin.get(`/api/meters/${own.id}`)).status).toBe(404);
});
it('счёт того же объекта, чужие id скрыты; самостоятельная корзина и восстановление с объектом', async () => {
  const id = await object();
  const other = await object();
  const acc = await adult.post(`/api/objects/${other}/accounts`, {});
  const rejected = await adult.post(`/api/objects/${id}/meters`, {
    data: { resource: 'cold_water' },
    utilityAccountId: acc.json<{ id: string }>().id,
  });
  expect(rejected.status).toBe(404);
  const own = await meter(id);
  const foreign = await meter(id, {}, {}, admin);
  const r = await reading(foreign.id, '2026-10-01', ['2']);
  expect((await adult.request('DELETE', `/api/meters/${own.id}`)).status).toBe(200);
  expect((await adult.post(`/api/objects/${id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/objects/${id}/restore`)).status).toBe(200);
  expect((await adult.get(`/api/meters/${own.id}`)).json<Meter>().deletedAt).not.toBeNull();
  expect((await adult.get(`/api/meters/${foreign.id}`)).json<Meter>().deletedAt).toBeNull();
  expect((await history(foreign.id))[0]?.id).toBe(r.id);
});
it('фото показания — только живое изображение своего объекта, вклад блокирует перенос в личное', async () => {
  const id = await object();
  const row = await meter(id);
  const file = randomUUID();
  await world.database.admin.query(
    `INSERT INTO object_files(id,parent_id,space_id,space_kind,audience,author_id,title,mime_type,size_bytes,storage_key,envelope) VALUES($1,$2,$3,'household','adults',$4,'Вымышленное фото','image/jpeg',1,$5,'{}')`,
    [file, id, world.houseId, world.boris.id, randomUUID()],
  );
  const res = await admin.post(`/api/meters/${row.id}/readings`, {
    occurredOn: '2026-10-01',
    values: ['3'],
    photoIds: [file],
  });
  expect(res.status, res.text).toBe(201);
  expect((await history(row.id))[0]?.photoIds).toEqual([file]);
  expect((await adult.post(`/api/objects/${id}/personal`)).status).toBe(403);
  const other = await meter(await object());
  expect(
    (
      await adult.post(`/api/meters/${other.id}/readings`, {
        occurredOn: '2026-10-01',
        values: ['1'],
        photoIds: [file],
      })
    ).status,
  ).toBe(404);
});
it('копия объекта сохраняет счётчики и показания с новыми id и ссылками на новые счета', async () => {
  const id = await object();
  const acc = await adult.post(`/api/objects/${id}/accounts`, {});
  const old = await meter(id, {}, { utilityAccountId: acc.json<{ id: string }>().id });
  await reading(old.id, '2026-10-01', ['123.456']);
  const copy = await adult.post(`/api/objects/${id}/copy`);
  expect(copy.status, copy.text).toBe(201);
  const target = copy.json<{ id: string }>().id;
  const rows = (await adult.get(`/api/objects/${target}/meters`)).json<
    (Meter & { utilityAccountId: string })[]
  >();
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw Error('Missing copied meter');
  expect(row.id).not.toBe(old.id);
  expect(row.utilityAccountId).not.toBe(acc.json<{ id: string }>().id);
  const readings = await history(row.id);
  expect(readings).toHaveLength(1);
  expect(readings[0]?.values).toEqual(['123.456']);
});
it('журнал не содержит номера прибора и значений query-параметров новых маршрутов', () => {
  expect(redactUrl('/api/meters/fictional-private?serialNumber=FICTION-SECRET')).toBe(
    '/api/meters/[redacted]',
  );
  expect(redactUrl('/api/readings/fictional-private?comment=private')).toBe(
    '/api/readings/[redacted]',
  );
  expect(world.requestLog.join('\n')).not.toContain('FICTION-SECRET-918273');
});
it('коррекция последнего отсчёта через корзину; открытие объекта не раскрывает прежнюю ленту ребёнку', async () => {
  const id = await object();
  const row = await meter(id);
  const first = await reading(row.id, '2026-09-01', ['1']);
  const last = await reading(row.id, '2026-10-01', ['2']);
  expect((await adult.request('DELETE', `/api/readings/${first.id}`)).status).toBe(409);
  expect((await adult.request('DELETE', `/api/readings/${last.id}`)).status).toBe(200);
  expect(
    (await adult.get(`/api/meters/${row.id}/readings?trash=true`))
      .json<Reading[]>()
      .map((r) => r.id),
  ).toEqual([last.id]);
  const corrected = await reading(row.id, '2026-10-01', ['2.1']);
  expect(corrected.consumption).toEqual(['1.100']);
  expect((await adult.post(`/api/readings/${last.id}/restore`)).status).toBe(409);
  const open = await adult.post(`/api/objects/${id}/audience`, {
    audience: 'household',
    confirmed: true,
  });
  expect(open.status, open.text).toBe(200);
  expect((await child.get(`/api/meters/${row.id}`)).status).toBe(200);
  const feed = await child.get(`/api/objects/${id}/timeline`);
  expect(feed.status, feed.text).toBe(200);
  expect(feed.text).not.toContain(corrected.id);
  expect(feed.text).not.toContain(first.id);
  expect(
    (
      await child.post(`/api/meters/${row.id}/readings`, {
        occurredOn: '2026-11-01',
        values: ['3'],
      })
    ).status,
  ).toBe(403);
});
it('замена в день последнего отсчёта и предупреждение по истории предшественника другой точности', async () => {
  const id = await object();
  const old = await meter(id);
  await reading(old.id, '2026-09-01', ['0']);
  await reading(old.id, '2026-10-01', ['10']);
  const replacement = await adult.post(`/api/meters/${old.id}/replace`, {
    finalReading: { occurredOn: '2026-10-01', values: ['20'] },
    newMeter: {
      data: { resource: 'cold_water', fractionDigits: 6 },
      initialReading: { occurredOn: '2026-10-01', values: ['0'] },
    },
  });
  expect(replacement.status, replacement.text).toBe(201);
  const next = replacement.json<{ newMeter: Meter }>().newMeter;
  expect((await reading(next.id, '2026-11-01', ['14'])).warnings).toHaveLength(1);
});
