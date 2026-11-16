import { createWorkerDatabase, type Database, deadlines } from '@homecrm/db';
import { canExportDeadline, type Placement, type Viewer } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { initializeHouseTimeZones } from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type Person, type World } from '../testing/world.ts';

let world: World;
const devices = new Map<Person['key'], Device>();
const rule = { kind: 'date', date: '2026-10-10', time: '09:00', warnings: [3] };

async function deadlineOn(device: Device, placement?: { spaceId: string; audience: string }) {
  const note = await device.post('/api/notes', {
    title: 'Вымышленная заметка со сроком',
    ...(placement ? { placement } : {}),
  });
  expect(note.status, note.text).toBe(201);
  const created = await device.post(`/api/notes/${note.json<{ id: string }>().id}/deadlines`, {
    rule,
  });
  expect(created.status, created.text).toBe(201);
  return created.json<{ id: string }>().id;
}

beforeAll(async () => {
  world = await createWorld();
  devices.set('anna', (await signedInAdmin(world)).device);
  for (const person of [world.boris, world.vera]) {
    const device = world.device();
    await device.signIn(person.username, person.password);
    devices.set(person.key, device);
  }
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
  // Личные сроки каждого, общие «Вся семья» и «Взрослые», дни рождения из профилей.
  for (const device of devices.values()) await deadlineOn(device);
  await deadlineOn(must('boris'), { spaceId: world.houseId, audience: 'household' });
  await deadlineOn(must('anna'), { spaceId: world.houseId, audience: 'adults' });
  await world.database.admin.query(
    "UPDATE member_profiles SET birth_date='1990-05-05', birthday_enabled=true",
  );
});
afterAll(async () => {
  await world?.close();
});

function must(key: Person['key']): Device {
  const device = devices.get(key);
  if (!device) throw new Error(`No device for ${key}`);
  return device;
}
function viewerOf(person: Person): Viewer {
  return { accountId: person.id, memberships: new Map([[world.houseId, person.role]]) };
}
function placementOf(row: typeof deadlines.$inferSelect): Placement {
  return row.spaceKind === 'personal'
    ? { kind: 'personal', spaceId: row.spaceId, ownerId: row.assigneeId ?? '' }
    : { kind: 'household', spaceId: row.spaceId, audience: row.audience ?? 'household' };
}

it('D53a: сроки в выгрузке — видимые участнику и разрешённые canExportDeadline, для каждой роли', async () => {
  let hidden = 0;
  let birthdaysOfOthers = 0;
  for (const person of [world.anna, world.boris, world.vera]) {
    const visible = await world.module.appDb.withAccount(person.id, (tx) =>
      tx.select().from(deadlines),
    );
    const exported = await must(person.key).post('/api/export', { password: person.password });
    expect(exported.status, exported.text).toBe(200);
    const ids = exported
      .json<{ deadlines: { id: string }[] }>()
      .deadlines.map(({ id }) => id)
      .sort();
    const allowed = visible.filter((row) =>
      canExportDeadline(viewerOf(person), {
        placement: placementOf(row),
        profileAccountId: row.profileAccountId,
      }),
    );
    expect(ids).toEqual(allowed.map(({ id }) => id).sort());
    // Выгрузка никогда не шире того, что участник видит под RLS.
    expect(visible.map(({ id }) => id)).toEqual(expect.arrayContaining(ids));
    hidden += visible.length - allowed.length;
    birthdaysOfOthers += visible.filter(
      (row) => row.profileAccountId && row.profileAccountId !== person.id,
    ).length;
    // Свой личный срок выгружается всегда.
    expect(allowed.some((row) => row.spaceKind === 'personal' && !row.profileAccountId)).toBe(true);
  }
  // Проверка не пустая: есть видимые, но не выгружаемые сроки, и среди них — чужие дни рождения.
  expect(hidden).toBeGreaterThan(0);
  expect(birthdaysOfOthers).toBeGreaterThan(0);
});

it('D53a: /api/me не пишет в базу, когда у домов задан часовой пояс', async () => {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error('The worker database must not be used by /api/me');
      },
    },
  ) as Database;
  const app = buildApp(
    { LOG_LEVEL: 'silent', APP_VERSION: 'test' },
    { auth: world.module, worker: forbidden },
  );
  try {
    const cookie = [...must('boris').cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({
      timeZone: 'Asia/Yekaterinburg',
      households: [{ householdId: world.houseId, timeZone: 'Asia/Yekaterinburg' }],
    });
    // Порядок полей ответа — как до переноса: дома добавлены в конец.
    expect(Object.keys(me.json()).at(-1)).toBe('households');
  } finally {
    await app.close();
  }
});
