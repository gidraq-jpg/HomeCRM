import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { loadAiConfig } from './config.ts';

let world: World;
beforeAll(async () => {
  world = await createWorld();
});
it('UTIL-9: список счетов работает без ИИ, чужое личное скрыто; разбор не хранит фото и начисление', async () => {
  const device = world.device();
  await device.signIn(world.boris.username, world.boris.password);
  const property = await device.post('/api/objects', {
    title: 'Учебная квитанция',
    objectType: 'property',
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  const account = await device.post(`/api/objects/${property.json().id}/accounts`, {
    title: 'Учебная вода',
    data: { number: '9900000010' },
  });
  expect(account.status).toBe(201);
  const { device: admin } = await signedInAdmin(world);
  const personal = await admin.post('/api/objects', {
    title: 'Личное Анны для проверки',
    objectType: 'property',
    placement: { spaceId: world.anna.personalSpaceId },
  });
  const hidden = await admin.post(`/api/objects/${personal.json().id}/accounts`, {
    title: 'Личный счёт Анны',
    data: { number: 'SECRET-ACCOUNT' },
  });
  expect(hidden.status).toBe(201);
  await world.database.admin.query('UPDATE spaces SET ai_enabled=false WHERE id=$1', [
    world.houseId,
  ]);
  const list = await device.get(`/api/ai/receipt-accounts?spaceId=${world.houseId}`);
  expect(list.status).toBe(200);
  expect(list.json<{ id: string }[]>().map((item) => item.id)).toContain(account.json().id);
  expect(list.text).not.toContain('SECRET-ACCOUNT');
  expect(list.text).not.toContain(hidden.json().id);
  await world.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    world.houseId,
  ]);
  const app = buildApp(
    { LOG_LEVEL: 'info', APP_VERSION: 'test' },
    {
      auth: world.module,
      ai: loadAiConfig({ AI_EXTRACT_PROVIDER: 'fake' }),
      logStream: { write: (line) => world.requestLog.push(line) },
    },
  );
  try {
    const form = new FormData();
    form.set(
      'file',
      new Blob([await readFile(new URL('./eval/samples/receipts/1.jpg', import.meta.url))], {
        type: 'image/jpeg',
      }),
      'fiction-receipt.jpg',
    );
    const multipart = new Response(form);
    const result = await app.inject({
      method: 'POST',
      url: `/api/ai/receipt-photo?spaceId=${world.houseId}&consent=true`,
      headers: {
        cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: 'http://homecrm.test',
        'content-type': multipart.headers.get('content-type') ?? '',
      },
      payload: Buffer.from(await multipart.arrayBuffer()),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().accountId.value).toBe(account.json().id);
    expect(result.json().totalCents.value).toBe(123456);
    expect(
      (await world.database.admin.query('SELECT count(*)::int AS n FROM utility_charges')).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await world.database.admin.query('SELECT count(*)::int AS n FROM object_files')).rows[0].n,
    ).toBe(0);
    for (const text of ['SECRET-ACCOUNT', '9900000010', 'fiction-receipt.jpg', 'data:image/jpeg'])
      expect(world.requestLog.join('')).not.toContain(text);
  } finally {
    await app.close();
  }
});

afterAll(async () => {
  await world?.close();
});
it('UTIL-4, AI-3/5: только видимый счётчик, согласие, без записи показания/фото и без содержимого в журнале', async () => {
  const device = world.device();
  let currentDevice = device;
  await device.signIn(world.boris.username, world.boris.password);
  const object = await device.post('/api/objects', {
    title: 'Учебная квартира',
    objectType: 'property',
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  expect(object.status).toBe(201);
  const meter = await device.post(`/api/objects/${object.json().id}/meters`, {
    title: 'Учебный счётчик',
    data: { resource: 'cold_water' },
  });
  expect(meter.status).toBe(201);
  const meterId = String(meter.json().id);
  await world.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    world.houseId,
  ]);
  const app = buildApp(
    { LOG_LEVEL: 'info', APP_VERSION: 'test' },
    {
      auth: world.module,
      ai: loadAiConfig({ AI_EXTRACT_PROVIDER: 'fake' }),
      logStream: { write: (line) => world.requestLog.push(line) },
    },
  );
  const bytes = await readFile(new URL('./eval/samples/meters/1.jpg', import.meta.url));
  async function extract(meterId: string, consent = 'true') {
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'fiction-photo.jpg');
    const multipart = new Response(form);
    return app.inject({
      method: 'POST',
      url: `/api/ai/meter-photo?spaceId=${world.houseId}&meterId=${meterId}&consent=${consent}`,
      headers: {
        cookie: [...currentDevice.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: 'http://homecrm.test',
        'content-type': multipart.headers.get('content-type') ?? '',
      },
      payload: Buffer.from(await multipart.arrayBuffer()),
    });
  }
  try {
    expect((await extract(meterId, 'false')).statusCode).toBe(400);
    const result = await extract(meterId);
    expect(result.statusCode).toBe(200);
    expect(result.json().values[0].value).toBe('1.222');
    const child = world.device();
    await child.signIn(world.vera.username, world.vera.password);
    currentDevice = child;
    expect((await extract(meterId)).statusCode).toBe(404);
    expect(
      (await world.database.admin.query('SELECT count(*)::int AS n FROM meter_readings')).rows[0].n,
    ).toBe(0);
    expect(
      (await world.database.admin.query('SELECT count(*)::int AS n FROM object_files')).rows[0].n,
    ).toBe(0);
    const log = world.requestLog.join('');
    for (const secret of ['fiction-photo.jpg', '1.222', 'data:image/jpeg', 'Учебный счётчик'])
      expect(log).not.toContain(secret);
  } finally {
    await app.close();
  }
});
