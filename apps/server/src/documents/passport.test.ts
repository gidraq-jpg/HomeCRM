import { createWorkerDatabase, sql } from '@homecrm/db';
import { DeadlineRule, DOCUMENT_WARNING_DEFAULTS, deadlineOccurrences } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { refreshDeadlines } from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  admin = (await signedInAdmin(world)).device;
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
afterAll(async () => world?.close());
async function rule(data: Record<string, unknown>, birth: string | null, reference = '2026-10-09') {
  return (
    await world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx.execute<{ rule: unknown }>(
        sql`SELECT app.document_rule(${JSON.stringify(data)}::jsonb,${birth}::date,${reference}::date) AS rule`,
      ),
    )
  ).rows[0]?.rule;
}
it('DOC-3: весь каталог предупреждений совпадает с SQL, явные пустые и собственные предупреждения', async () => {
  for (const [type, warnings] of Object.entries(DOCUMENT_WARNING_DEFAULTS)) {
    expect(await rule({ type, expiresOn: '2026-12-01' }, null)).toMatchObject({ warnings });
  }
  expect(await rule({ type: 'other', expiresOn: '2026-12-01', warnings: [] }, null)).toMatchObject({
    warnings: [],
  });
  expect(
    await rule({ type: 'other', expiresOn: '2026-12-01', warnings: [17, 4] }, null),
  ).toMatchObject({ warnings: [17, 4] });
});
it('DOC-4: 20 и 45 лет, предупреждения до рождения в 09:00 дома, 90 дней на замену и 29 февраля', async () => {
  for (const [birth, issuedOn] of [
    ['2006-12-01', '2020-01-01'],
    ['1981-12-01', '2002-01-01'],
  ]) {
    const parsed = DeadlineRule.parse(
      await rule({ type: 'russian_passport', issuedOn }, birth ?? null),
    );
    expect(parsed).toMatchObject({
      kind: 'window',
      date: '2026-12-01',
      durationDays: 90,
      warnings: [60, 30],
    });
    const [occurrence] = deadlineOccurrences(
      parsed,
      new Date('2026-10-01T00:00:00Z'),
      'Asia/Yekaterinburg',
      365,
      true,
    );
    expect(occurrence?.startsAt.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(occurrence?.endsAt.toISOString()).toBe('2027-03-01T18:59:00.000Z');
    expect(occurrence?.warningsAt.map((d) => d.toISOString())).toEqual([
      '2026-10-02T04:00:00.000Z',
      '2026-11-01T04:00:00.000Z',
    ]);
  }
  expect(
    await rule({ type: 'russian_passport', issuedOn: '2002-01-01' }, '1980-02-29'),
  ).toMatchObject({ date: '2025-02-28' });
  expect(await rule({ type: 'russian_passport', issuedOn: '2025-02-28' }, '1980-02-29')).toBeNull();
  expect(
    await rule({ type: 'russian_passport', expiresOn: '2030-01-01' }, '2006-12-01'),
  ).toMatchObject({ kind: 'date', date: '2030-01-01', durationDays: 0 });
  expect(await rule({ type: 'russian_passport', indefinite: true }, '2006-12-01')).toBeNull();
});
it('DOC-4: смена рождения участника пересчитывает скрытый от него документ и радар; явный срок сохраняется', async () => {
  expect(
    (await adult.request('PATCH', '/api/me/profile', { json: { birthDate: '2006-12-01' } })).status,
  ).toBe(200);
  const response = await admin.post('/api/documents', {
    title: 'Вымышленный паспорт участника',
    owner: { kind: 'member', id: world.boris.id },
    data: { type: 'russian_passport', issuedOn: '2020-01-01' },
  });
  expect(response.status, response.text).toBe(201);
  const doc = response.json<{ id: string }>();
  const explicit = (
    await admin.post('/api/documents', {
      title: 'Вымышленный явный паспорт',
      owner: { kind: 'member', id: world.boris.id },
      data: { type: 'russian_passport', expiresOn: '2030-01-01' },
    })
  ).json<{ id: string }>();
  expect((await adult.get(`/api/documents/${doc.id}`)).status).toBe(404);
  const before = (await admin.get(`/api/documents/${doc.id}`)).json();
  expect(before).toMatchObject({ expiryRule: { date: '2026-12-01' } });
  const changed = await adult.request('PATCH', '/api/me/profile', {
    json: { birthDate: '2006-11-15' },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await admin.get(`/api/documents/${doc.id}`)).json()).toMatchObject({
    expiryRule: { date: '2026-11-15' },
  });
  expect((await admin.get(`/api/documents/${explicit.id}`)).json()).toMatchObject({
    expiryRule: { date: '2030-01-01' },
  });
  const worker = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(worker, new Date('2026-10-09T00:00:00Z'), true);
  const radar = await admin.get('/api/deadlines?from=2026-01-01&to=2031-12-31');
  expect(radar.status, radar.text).toBe(200);
  expect(radar.json<{ items: unknown[] }>().items).toEqual(
    expect.arrayContaining([expect.objectContaining({ documentId: doc.id, date: '2026-11-15' })]),
  );
  expect((await adult.get('/api/deadlines?from=2026-01-01&to=2031-12-31')).text).not.toContain(
    doc.id,
  );
});
it('DOC-4: контакт без года не даёт возраст; добавление, смена и удаление даты пересчитывают паспорт', async () => {
  const contact = (
    await adult.post('/api/contacts', {
      title: 'Вымышленный владелец паспорта',
      kind: 'person',
      data: { birthday: '--12-01' },
    })
  ).json<{ id: string }>();
  const response = await adult.post('/api/documents', {
    title: 'Вымышленный паспорт контакта',
    owner: { kind: 'contact', id: contact.id },
    data: { type: 'russian_passport', issuedOn: '2020-01-01', warnings: [15, 2] },
  });
  expect(response.status, response.text).toBe(201);
  const doc = response.json<{ id: string }>();
  expect(response.json()).toMatchObject({ expiryRule: { kind: 'after', eventDate: null } });
  expect(
    (
      await adult.request('PATCH', `/api/contacts/${contact.id}`, {
        json: { data: { birthday: '2006-12-01' } },
      })
    ).status,
  ).toBe(200);
  expect((await adult.get(`/api/documents/${doc.id}`)).json()).toMatchObject({
    expiryRule: { date: '2026-12-01', warnings: [15, 2] },
  });
  await adult.request('PATCH', `/api/contacts/${contact.id}`, {
    json: { data: { birthday: null } },
  });
  expect((await adult.get(`/api/documents/${doc.id}`)).json()).toMatchObject({
    expiryRule: { kind: 'after', eventDate: null },
  });
});

it('DOC-4/SPACE-3: закрытая дата контакта не передаётся в ранее связанный общий или чужой личный паспорт', async () => {
  const response = await adult.post('/api/contacts', {
    title: 'Вымышленный контакт границы доступа',
    kind: 'person',
    placement: { spaceId: world.houseId, audience: 'household' },
    data: { birthday: '2006-12-01' },
  });
  expect(response.status, response.text).toBe(201);
  const contact = response.json<{ id: string }>();
  const create = async (device: Device, shared = false) => {
    const result = await device.post('/api/documents', {
      title: 'Вымышленный паспорт границы доступа',
      owner: { kind: 'contact', id: contact.id },
      data: { type: 'russian_passport', issuedOn: '2020-01-01' },
      ...(shared ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
    });
    expect(result.status, result.text).toBe(201);
    expect(result.json()).toMatchObject({ expiryRule: { date: '2026-12-01' } });
    return result.json<{ id: string }>();
  };
  const own = await create(adult),
    foreign = await create(admin),
    shared = await create(admin, true);
  expect(
    (
      await adult.post(`/api/contacts/${contact.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  const changed = await adult.request('PATCH', `/api/contacts/${contact.id}`, {
    json: { data: { birthday: '2006-11-10' } },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await admin.get(`/api/contacts/${contact.id}`)).status).toBe(404);
  expect((await adult.get(`/api/documents/${own.id}`)).json()).toMatchObject({
    expiryRule: { date: '2026-11-10' },
  });
  for (const doc of [foreign, shared])
    expect((await admin.get(`/api/documents/${doc.id}`)).json()).toMatchObject({
      expiryRule: { date: '2026-12-01' },
    });
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-09T00:00:00Z'),
    true,
  );
  const radar = (await admin.get('/api/deadlines?from=2026-01-01&to=2031-12-31')).json<{
    items: { documentId: string; date: string }[];
  }>();
  for (const doc of [foreign, shared])
    expect(radar.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ documentId: doc.id, date: '2026-12-01' })]),
    );
});

it('DOC-4/SPACE-3: взрослое поле не обновляет паспорт ребёнка, но обновляет личный паспорт взрослого', async () => {
  const child = world.device();
  await child.signIn(world.vera.username, world.vera.password);
  const response = await adult.post('/api/contacts', {
    title: 'Вымышленный контакт взрослой аудитории',
    kind: 'person',
    placement: { spaceId: world.houseId, audience: 'household' },
    data: { birthday: '2006-12-01' },
  });
  expect(response.status, response.text).toBe(201);
  const contact = response.json<{ id: string }>();
  const create = async (device: Device) => {
    const result = await device.post('/api/documents', {
      title: 'Вымышленный паспорт взрослой аудитории',
      owner: { kind: 'contact', id: contact.id },
      data: { type: 'russian_passport', issuedOn: '2020-01-01' },
    });
    expect(result.status, result.text).toBe(201);
    return result.json<{ id: string }>();
  };
  const childDoc = await create(child),
    adultDoc = await create(admin);
  expect(
    (
      await adult.post(`/api/contacts/${contact.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  const changed = await adult.request('PATCH', `/api/contacts/${contact.id}`, {
    json: { data: { birthday: '2006-11-10' } },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await child.get(`/api/documents/${childDoc.id}`)).json()).toMatchObject({
    expiryRule: { date: '2026-12-01' },
  });
  expect((await admin.get(`/api/documents/${adultDoc.id}`)).json()).toMatchObject({
    expiryRule: { date: '2026-11-10' },
  });
});

it('DOC-4/SPACE-10: после ухода участника новая дата профиля не попадает в паспорт бывшей семьи', async () => {
  const isolated = await createWorld();
  try {
    const former = isolated.device(),
      reader = (await signedInAdmin(isolated)).device;
    await former.signIn(isolated.boris.username, isolated.boris.password);
    expect(
      (await former.request('PATCH', '/api/me/profile', { json: { birthDate: '2006-12-01' } }))
        .status,
    ).toBe(200);
    const create = async (device: Device) => {
      const result = await device.post('/api/documents', {
        title: 'Вымышленный паспорт бывшей семьи',
        owner: { kind: 'member', id: isolated.boris.id },
        data: { type: 'russian_passport', issuedOn: '2020-01-01' },
      });
      expect(result.status, result.text).toBe(201);
      return result.json<{ id: string }>();
    };
    const own = await create(former),
      foreign = await create(reader);
    expect((await former.post(`/api/households/${isolated.houseId}/leave`, {})).status).toBe(200);
    const changed = await former.request('PATCH', '/api/me/profile', {
      json: { birthDate: '2006-11-10' },
    });
    expect(changed.status, changed.text).toBe(200);
    expect((await reader.get(`/api/documents/${foreign.id}`)).json()).toMatchObject({
      expiryRule: { date: '2026-12-01' },
    });
    expect((await former.get(`/api/documents/${own.id}`)).json()).toMatchObject({
      expiryRule: { date: '2026-11-10' },
    });
  } finally {
    await isolated.close();
  }
});
