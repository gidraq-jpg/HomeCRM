import { randomBytes, randomUUID } from 'node:crypto';
import { createWorkerDatabase, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import {
  enqueueDeadlineWarnings,
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../deadlines/engine.ts';
import { redactUrl } from '../logging.ts';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device, child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => world?.close());
type Contact = {
  id: string;
  updatedAt: string;
  data: Record<string, unknown>;
  organizationId: string | null;
};
async function person(
  data: Record<string, unknown>,
  audience: 'adults' | 'household' | 'personal' = 'personal',
  device = adult,
) {
  const r = await device.post('/api/contacts', {
    title: 'Вымышленный контакт дня рождения',
    kind: 'person',
    data,
    ...(audience === 'personal' ? {} : { placement: { spaceId: world.houseId, audience } }),
  });
  expect(r.status, r.text).toBe(201);
  return r.json<Contact>();
}
const content = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Импортированное имя',
  'TEL:+7 900 000 00 01',
  'EMAIL:import@example.test',
  'ORG:Вымышленная компания',
  'NOTE:Заметка импорта',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Вымышленный новый',
  'TEL:tel:+79000000002',
  'BDAY:--02-29',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Вымышленный третий',
  'TEL:+79000000003',
  'END:VCARD',
].join('\n');
it('CONT-6: три карточки, только видимые совпадения, предпросмотр не пишет; атомарное объединение и повтор', async () => {
  const old = await person({
    phones: [{ number: '8 (900) 000-00-01', label: 'Основной' }],
    address: 'Сохранённый адрес',
    note: 'Старый текст',
  });
  const hidden = await person({ phones: [{ number: '+79000000002' }] }, 'personal', admin);
  const before = (await adult.get('/api/contacts')).json<unknown[]>().length;
  const input = { fileName: 'contacts.vcf', content };
  const preview = await adult.post('/api/contacts/import', input);
  expect(preview.status, preview.text).toBe(200);
  const body = preview.json<{ previewHash: string; items: { matches: { id: string }[] }[] }>();
  expect(body.items.map((i) => i.matches.map((m) => m.id))).toEqual([[old.id], [], []]);
  expect(preview.text).not.toContain(hidden.id);
  expect((await adult.get('/api/contacts')).json<unknown[]>()).toHaveLength(before);
  const apply = {
    ...input,
    mode: 'apply',
    previewHash: body.previewHash,
    idempotencyKey: randomUUID(),
    choices: [
      { index: 0, action: 'merge', contactId: old.id, updatedAt: old.updatedAt },
      { index: 1, action: 'create' },
      { index: 2, action: 'create' },
    ],
  };
  const results = await Promise.all([
    adult.post('/api/contacts/import', apply),
    adult.post('/api/contacts/import', apply),
  ]);
  for (const r of results) expect(r.status, r.text).toBe(200);
  expect(results[0]?.json().contactIds).toEqual(results[1]?.json().contactIds);
  const result = (await adult.get(`/api/contacts/${old.id}`)).json<Contact>();
  expect(result.data).toMatchObject({
    address: 'Сохранённый адрес',
    note: 'Старый текст\nЗаметка импорта',
    emails: ['import@example.test'],
    phones: [{ label: 'Основной' }],
  });
  expect(result.organizationId).toBeTruthy();
  expect((await adult.get('/api/contacts')).json<unknown[]>()).toHaveLength(before + 3);
  expect(
    (
      await adult.post('/api/contacts/import', {
        ...apply,
        choices: [
          { index: 0, action: 'create' },
          { index: 1, action: 'create' },
          { index: 2, action: 'create' },
        ],
      })
    ).status,
  ).toBe(409);
});
it('CONT-6: битый файл и устаревшее/скрытое объединение не оставляют частичного импорта', async () => {
  const before = (await adult.get('/api/contacts')).json<unknown[]>().length;
  expect(
    (
      await adult.post('/api/contacts/import', {
        fileName: 'bad.vcf',
        content: `${content}\nBEGIN:VCARD`,
      })
    ).status,
  ).toBe(400);
  expect((await adult.get('/api/contacts')).json<unknown[]>()).toHaveLength(before);
  const p = await person({ phones: [{ number: '+79000000001' }] });
  const preview = (
    await adult.post('/api/contacts/import', { fileName: 'test.vcf', content })
  ).json<{ previewHash: string }>();
  await adult.request('PATCH', `/api/contacts/${p.id}`, {
    json: { data: { note: 'Изменено после предпросмотра' } },
  });
  const count = (await adult.get('/api/contacts')).json<unknown[]>().length;
  const apply = {
    fileName: 'test.vcf',
    content,
    mode: 'apply',
    previewHash: preview.previewHash,
    idempotencyKey: randomUUID(),
    choices: [
      { index: 0, action: 'merge', contactId: p.id, updatedAt: p.updatedAt },
      { index: 1, action: 'create' },
      { index: 2, action: 'create' },
    ],
  };
  expect((await adult.post('/api/contacts/import', apply)).status).toBe(409);
  expect((await adult.get('/api/contacts')).json<unknown[]>()).toHaveLength(count);
});
it('CONT-6: общий импорт фиксируется в истории; URL и журнал не содержат файл и поля', async () => {
  const input = {
    fileName: 'test.vcf',
    content,
    placement: { spaceId: world.houseId, audience: 'adults' },
  };
  const preview = (await adult.post('/api/contacts/import', input)).json<{ previewHash: string }>();
  const result = await adult.post('/api/contacts/import', {
    ...input,
    mode: 'apply',
    previewHash: preview.previewHash,
    idempotencyKey: randomUUID(),
    choices: [0, 1, 2].map((index) => ({ index, action: 'create' })),
  });
  expect(result.status, result.text).toBe(200);
  const id = result.json<{ contactIds: string[] }>().contactIds[0];
  const history = (await adult.get(`/api/contacts/${id}/history`)).json<
    { changes: Record<string, unknown> }[]
  >();
  expect(history.some((h) => 'import' in h.changes)).toBe(true);
  expect(redactUrl('/api/contacts/import?phone=secret&birthday=secret')).toBe(
    '/api/contacts/import',
  );
  expect(world.requestLog.join('')).not.toContain('import@example.test');
  expect(world.requestLog.join('')).not.toContain('Заметка импорта');
});
it('CONT-7: ежегодный срок без возраста, предупреждения 7/1; взрослый контакт скрыт ребёнку, выключение немедленное', async () => {
  const row = await person({ birthday: '--10-10', birthdayEnabled: true }, 'adults');
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-09T05:00:00Z'),
    true,
  );
  const url = '/api/deadlines?from=2026-10-01&to=2027-10-02';
  const radar = (await adult.get(url)).json<{
    items: { contactId: string; age: number | null; warningsAt: string[] }[];
  }>();
  expect(radar.items.find((i) => i.contactId === row.id)).toMatchObject({
    age: null,
    warningsAt: ['2026-10-03T04:00:00.000Z', '2026-10-09T04:00:00.000Z'],
  });
  expect((await child.get(url)).text).not.toContain(row.id);
  expect((await admin.get(url)).text).toContain(row.id);
  const patch = await adult.request('PATCH', `/api/contacts/${row.id}`, {
    json: { data: { birthdayEnabled: false } },
  });
  expect(patch.status, patch.text).toBe(200);
  expect((await adult.get(url)).text).not.toContain(row.id);
});
it('CONT-6: multipart-файл даёт предпросмотр; размер, расширение, вторая часть и повреждённый UTF-8 отвергаются', async () => {
  const boundary = 'vcard-test-boundary';
  const upload = async (bytes: Buffer, name = 'test.vcf', second = false) =>
    world.app.inject({
      method: 'POST',
      url: '/api/contacts/import',
      headers: {
        origin: 'http://homecrm.test',
        cookie: [...adult.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/vcard\r\n\r\n`,
        ),
        bytes,
        Buffer.from(
          `\r\n${second ? `--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nextra\r\n` : ''}--${boundary}--\r\n`,
        ),
      ]),
    });
  const valid = await upload(Buffer.from(content));
  expect(valid.statusCode, valid.body).toBe(200);
  expect(valid.json().items).toHaveLength(3);
  expect((await upload(Buffer.from(content), 'test.txt')).statusCode).toBe(400);
  expect((await upload(Buffer.from([0xff]))).statusCode).toBe(400);
  expect((await upload(Buffer.alloc(512 * 1024 + 1, 65))).statusCode).toBe(413);
  expect((await upload(Buffer.from(content), 'test.vcf', true)).statusCode).toBe(413);
});
it('CONT-7: 29 февраля → 28 февраля, полный год даёт возраст; профиль использует ту же видимость', async () => {
  const row = await person({ birthday: '2000-02-29', birthdayEnabled: true }, 'household');
  const profile = await adult.request('PATCH', '/api/me/profile', {
    json: { birthDate: '1990-02-28', birthdayEnabled: true },
  });
  expect(profile.status, profile.text).toBe(200);
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2027-02-21T05:00:00Z'),
    true,
  );
  await world.database.admin.query("UPDATE sessions SET expires_at='2028-01-01'");
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-02-21T05:00:00Z'));
  try {
    const items = (await child.get('/api/deadlines?from=2027-02-21&to=2028-02-22')).json<{
      items: { contactId: string; profileAccountId: string; date: string; age: number }[];
    }>().items;
    expect(items.find((i) => i.contactId === row.id)).toMatchObject({
      date: '2027-02-28',
      age: 27,
    });
    expect(items.find((i) => i.profileAccountId === world.boris.id)).toMatchObject({
      date: '2027-02-28',
      age: 37,
    });
  } finally {
    vi.useRealTimers();
  }
});
it('CONT-7: сужение аудитории, перенос, корзина и восстановление не оставляют открытой производной даты', async () => {
  const row = await person({ birthday: '--10-10', birthdayEnabled: true }, 'household');
  const db = createWorkerDatabase(world.database.worker),
    now = new Date('2026-10-09T05:00:00Z');
  await refreshDeadlines(db, now, true);
  const url = '/api/deadlines?from=2026-10-09&to=2027-10-10';
  expect((await child.get(url)).text).toContain(row.id);
  const narrow = await adult.post(`/api/contacts/${row.id}/move`, {
    spaceId: world.houseId,
    audience: 'adults',
    confirmed: true,
  });
  expect(narrow.status, narrow.text).toBe(200);
  expect((await child.get(url)).text).not.toContain(row.id);
  const personal = await adult.post(`/api/contacts/${row.id}/move`, {
    spaceId: world.boris.personalSpaceId,
    confirmed: true,
  });
  expect(personal.status, personal.text).toBe(200);
  expect((await admin.get(url)).text).not.toContain(row.id);
  const trashed = await adult.post(`/api/contacts/${row.id}/trash`);
  expect(trashed.status, trashed.text).toBe(200);
  expect((await adult.get(url)).text).not.toContain(row.id);
  const restored = await adult.post(`/api/contacts/${row.id}/restore`);
  expect(restored.status, restored.text).toBe(200);
  await refreshDeadlines(db, now, true);
  expect((await adult.get(url)).text).toContain(row.id);
});
it('CONT-7: push с именем только при открытом тексте; выключение источника отменяет ожидающий push', async () => {
  await world.database.admin.query('DELETE FROM deadline_notifications');
  const row = await person({ birthday: '--10-10', birthdayEnabled: true });
  await adult.post('/api/push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString('base64url'),
    },
    deviceName: 'Вымышленный телефон',
  });
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100, hideText: true },
  });
  const db = createWorkerDatabase(world.database.worker),
    now = new Date('2026-10-03T04:00:00Z');
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.find((c) => c[1].recordId === row.id)?.[1].text).toBe(
    'В HomeCRM есть новое',
  );
  await adult.request('PATCH', '/api/notifications/settings', { json: { hideText: false } });
  const next = new Date('2026-10-09T04:00:00Z');
  await enqueueDeadlineWarnings(db, next);
  await dispatchNotifications(world.database.worker, send, next);
  expect(send.mock.calls.filter((c) => c[1].recordId === row.id).at(-1)?.[1].text).toBe(
    'День рождения: Вымышленный контакт дня рождения',
  );
  await adult.request('PATCH', `/api/contacts/${row.id}`, {
    json: { data: { birthdayEnabled: false } },
  });
  expect(
    (
      await world.database.worker.query('SELECT app.birthday_delivery_name($1,NULL,$2) AS name', [
        row.id,
        world.boris.id,
      ])
    ).rows[0]?.name,
  ).toBe(null);
  await expect(
    world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx.execute(
        sql`SELECT app.birthday_delivery_name(${row.id}::uuid,NULL,${world.boris.id}::uuid)`,
      ),
    ),
  ).rejects.toThrow();
});
