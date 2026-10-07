import { randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { cleanupExpired } from '../auth/cleanup.ts';
import * as fileExport from '../files/export.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let admin: Device;
let adult: Device;
let child: Device;
const rosterUrl = () => `/api/households/${world.houseId}/members`;
const memberUrl = (id: string) => `${rosterUrl()}/${id}`;
beforeAll(async () => {
  world = await createWorld();
  admin = (await signedInAdmin(world)).device;
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
});
afterAll(async () => {
  await world?.close();
});

it('взрослый и ребёнок видят состав и семейные поля, без логина, почты и сведений входа', async () => {
  const edited = await adult.request('PATCH', '/api/me/profile', {
    json: {
      displayName: 'Борис Вымышленный',
      birthDate: '1990-01-02',
      phone: '+7 000 000-00-00',
      photoFileId: null,
    },
  });
  expect(edited.status).toBe(200);
  for (const device of [adult, child]) {
    const response = await device.get(rosterUrl());
    expect(response.status).toBe(200);
    const rows = response.json<Array<Record<string, unknown>>>();
    expect(rows.map((r) => r.accountId).sort()).toEqual(
      [world.anna.id, world.boris.id, world.vera.id].sort(),
    );
    expect(rows.find((r) => r.accountId === world.boris.id)).toMatchObject({
      displayName: 'Борис Вымышленный',
      birthDate: '1990-01-02',
      phone: '+7 000 000-00-00',
      isAdult: true,
      formerMember: false,
    });
    for (const row of rows)
      for (const field of ['email', 'username', 'twoFactorEnabled', 'password', 'token'])
        expect(row).not.toHaveProperty(field);
    expect((await device.get(`/api/households/${randomUUID()}/members`)).status).toBe(404);
  }
  expect((await adult.get('/api/me')).json().displayName).toBe('Борис Вымышленный');
  expect(
    (
      await child.request('PATCH', '/api/me/profile', {
        json: { accountId: world.boris.id, phone: 'подмена' },
      })
    ).status,
  ).toBe(400);
});

it('R0.5d: фото участников читаются последовательно на соединении транзакции', async () => {
  let active = 0,
    maxActive = 0;
  const original = fileExport.visibleProfileFile;
  const spy = vi.spyOn(fileExport, 'visibleProfileFile').mockImplementation(async (...args) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await original(...args);
    } finally {
      active--;
    }
  });
  try {
    const result = await adult.get(rosterUrl());
    expect(result.status, result.text).toBe(200);
    expect(result.json<unknown[]>()).toHaveLength(3);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

it('не-администратор не меняет роли, не исключает и не выдаёт ссылки сброса', async () => {
  for (const device of [adult, child]) {
    expect(
      (
        await device.request('PATCH', `${memberUrl(world.vera.id)}/role`, {
          json: { role: 'admin' },
        })
      ).status,
    ).toBe(403);
    expect((await device.post(`${memberUrl(world.boris.id)}/exclude`, {})).status).toBe(403);
    expect((await device.post(`${memberUrl(world.vera.id)}/password-reset`, {})).status).toBe(403);
  }
  expect((await admin.post(`${memberUrl(world.anna.id)}/exclude`, {})).status).toBe(403);
});

it('последний администратор не уходит и не теряет роль', async () => {
  expect((await admin.post(`/api/households/${world.houseId}/leave`, {})).json().code).toBe(
    'LAST_ADMIN',
  );
  const changed = await admin.request('PATCH', `${memberUrl(world.anna.id)}/role`, {
    json: { role: 'adult' },
  });
  expect(changed.status).toBe(409);
  expect(changed.json().code).toBe('LAST_ADMIN');
  expect(
    (await admin.request('PATCH', `${memberUrl(world.vera.id)}/role`, { json: { role: 'adult' } }))
      .status,
  ).toBe(200);
  expect(
    (await admin.request('PATCH', `${memberUrl(world.vera.id)}/role`, { json: { role: 'child' } }))
      .status,
  ).toBe(200);
});

it('приглашения дома связаны с существующим AUTH-2; список закрыт от остальных', async () => {
  const invitation = await admin.post('/api/invitations', {
    householdId: world.houseId,
    role: 'child',
  });
  expect(invitation.status).toBe(201);
  const url = `/api/households/${world.houseId}/invitations`;
  const rows = (await admin.get(url)).json<Array<Record<string, unknown>>>();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: invitation.json().id, role: 'child' });
  expect(rows[0]).not.toHaveProperty('tokenHash');
  for (const device of [adult, child]) expect((await device.get(url)).status).toBe(403);
});

it('AUTH-5: администратор выдаёт ссылку ребёнку; взрослому и ребёнку-взрослому другого дома отказ', async () => {
  const result = await admin.post(`${memberUrl(world.vera.id)}/password-reset`, {});
  expect(result.status).toBe(200);
  expect(result.json().url).toMatch(/\/reset-password\?token=/);
  expect((await admin.post(`${memberUrl(world.boris.id)}/password-reset`, {})).status).toBe(403);
  const houseId = randomUUID();
  await world.database.admin.query(
    "INSERT INTO spaces(id, kind, name) VALUES ($1, 'household', 'Другой вымышленный дом')",
    [houseId],
  );
  await world.database.admin.query(
    "INSERT INTO space_members(space_id, account_id, role) VALUES ($1, $2, 'adult')",
    [houseId, world.vera.id],
  );
  expect((await admin.post(`${memberUrl(world.vera.id)}/password-reset`, {})).status).toBe(403);
  expect((await admin.get(`/api/households/${houseId}/members`)).status).toBe(404);
  expect(world.requestLog.join('\n')).not.toContain(result.json().token);
});

it('ошибка базы в профиле не раскрывает параметры запроса в журнале', async () => {
  const marker = 'fictional-private-phone';
  await world.database.admin.query(
    "ALTER TABLE member_profiles ADD CONSTRAINT test_phone CHECK (phone <> 'fictional-private-phone')",
  );
  try {
    const result = await adult.request('PATCH', '/api/me/profile', { json: { phone: marker } });
    expect(result.status).toBe(409);
    expect(world.requestLog.join('\n')).not.toContain(marker);
    expect(world.requestLog.join('\n')).not.toContain('Failed query');
  } finally {
    await world.database.admin.query('ALTER TABLE member_profiles DROP CONSTRAINT test_phone');
  }
});

it('при нескольких завершённых сбросах /api/me показывает последнюю отметку', async () => {
  const latest = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
  for (const completed of [old, latest])
    await world.database.admin.query(
      'INSERT INTO password_resets(account_id, requested_by, expires_at, completed_at) VALUES ($1, $2, now(), $3)',
      [world.vera.id, world.anna.id, completed],
    );
  const me = (await child.get('/api/me')).json<{
    passwordReset: { completedAt: string; ackAllowedAt: string };
  }>();
  expect(me.passwordReset.completedAt).toBe(latest.toISOString());
  expect(me.passwordReset.ackAllowedAt).toBe(
    new Date(latest.getTime() + 7 * 86400_000).toISOString(),
  );
});

it('исключение сохраняет личное и автора общего, передаёт ответственность и показывает бывшего участника', async () => {
  const mine = (await adult.post('/api/notes', { title: 'Личное Бориса' })).json();
  const common = (
    await adult.post('/api/notes', {
      title: 'Общая заметка Бориса',
      placement: { spaceId: world.houseId, audience: 'household' },
      checklist: [{ title: 'Пункт Бориса' }],
    })
  ).json();
  expect((await admin.post(`${memberUrl(world.boris.id)}/exclude`, {})).status).toBe(200);
  expect((await adult.get(`/api/notes/${mine.id}`)).status).toBe(200);
  expect((await adult.get(`/api/notes/${common.id}`)).status).toBe(404);
  expect((await adult.get(rosterUrl())).status).toBe(404);
  expect((await adult.get('/api/me/profile')).status).toBe(200);
  const note = (await admin.get(`/api/notes/${common.id}`)).json();
  expect(note.authorId).toBe(world.boris.id);
  expect(note.assigneeId).toBe(world.anna.id);
  const items = (
    await world.database.admin.query(
      'SELECT author_id, assignee_id, title FROM note_items WHERE parent_id = $1',
      [common.id],
    )
  ).rows;
  expect(items).toEqual([
    { author_id: world.boris.id, assignee_id: world.anna.id, title: 'Пункт Бориса' },
  ]);
  const rows = (await child.get(rosterUrl())).json<Array<Record<string, unknown>>>();
  expect(rows.find((r) => r.accountId === world.boris.id)).toMatchObject({
    formerMember: true,
    displayName: 'Борис Вымышленный',
    phone: null,
    birthDate: null,
    photoFileId: null,
  });
  expect(
    (
      await adult.request('PATCH', '/api/me/profile', {
        json: { displayName: 'Борис после ухода', phone: 'private-after-leaving' },
      })
    ).status,
  ).toBe(200);
  const after = (await child.get(rosterUrl())).json<Array<Record<string, unknown>>>();
  expect(after.find((r) => r.accountId === world.boris.id)).toMatchObject({
    displayName: 'Борис после ухода',
    phone: null,
  });
});

it('участник уходит сам из выбранного дома, сохраняя другой дом и личное', async () => {
  expect((await child.post(`/api/households/${world.houseId}/leave`, {})).status).toBe(200);
  expect((await child.get(rosterUrl())).status).toBe(404);
  expect((await child.get('/api/me')).json().roles).toHaveLength(1);
  expect((await child.get('/api/me/profile')).status).toBe(200);
});

it('сбой передачи после ухода сообщает о повторе и не раскрывает текст; обработчик завершает передачу', async () => {
  const separate = await createWorld();
  try {
    const owner = (await signedInAdmin(separate)).device;
    const device = separate.device();
    await device.signIn(separate.boris.username, separate.boris.password);
    const title = 'Вымышленный текст, который нельзя журналировать';
    const note = (
      await device.post('/api/notes', {
        title,
        placement: { spaceId: separate.houseId, audience: 'household' },
      })
    ).json();
    await separate.database.admin.query(
      `ALTER TABLE notes ADD CONSTRAINT test_reassign CHECK (assignee_id <> '${separate.anna.id}')`,
    );
    const response = await owner.post(
      `/api/households/${separate.houseId}/members/${separate.boris.id}/exclude`,
      {},
    );
    expect(response.status).toBe(503);
    expect(response.json().code).toBe('RESPONSIBILITY_PENDING');
    expect(
      (
        await separate.database.admin.query(
          'SELECT left_at FROM space_members WHERE space_id=$1 AND account_id=$2',
          [separate.houseId, separate.boris.id],
        )
      ).rows[0]?.left_at,
    ).not.toBeNull();
    expect(separate.requestLog.join('\n')).not.toContain(title);
    expect(separate.requestLog.join('\n')).not.toContain('Failed query');
    await separate.database.admin.query('ALTER TABLE notes DROP CONSTRAINT test_reassign');
    const report = await cleanupExpired(createWorkerDatabase(separate.database.worker));
    expect(report.reassigned).toBe(1);
    expect(
      (await separate.database.admin.query('SELECT assignee_id FROM notes WHERE id=$1', [note.id]))
        .rows[0]?.assignee_id,
    ).toBe(separate.anna.id);
  } finally {
    await separate.close();
  }
});
