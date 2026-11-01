import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hash } from '../oauth/routes.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, admin: Device;
beforeAll(async () => {
  world = await createWorld();
  admin = (await signedInAdmin(world)).device;
  expect(
    (await admin.post('/api/chat/settings', { id: world.houseId, enabled: true })).status,
  ).toBe(200);
});
afterAll(async () => world?.close());
async function connect(device: Device) {
  const client = await world.app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: { client_name: 'Учебный Claude', redirect_uris: ['https://client.example/callback'] },
  });
  expect(client.statusCode, client.body).toBe(201);
  const verifier = randomBytes(32).toString('base64url');
  const authorization = {
    client_id: client.json().client_id,
    redirect_uri: 'https://client.example/callback',
    response_type: 'code',
    code_challenge: hash(verifier),
    code_challenge_method: 'S256',
    resource: 'http://homecrm.test/mcp',
    state: 'test-state',
  };
  // Экран согласия показывает сайт возврата: название клиента выбирает сам клиент.
  const screen = await device.get(
    `/api/chat/consent?${new URLSearchParams(authorization as Record<string, string>)}`,
  );
  expect(screen.status, screen.text).toBe(200);
  expect(screen.json<{ host: string }>().host).toBe('client.example');
  const consent = await device.post('/api/chat/consent', {
    authorization,
    houseId: world.houseId,
    approve: true,
  });
  expect(consent.status, consent.text).toBe(200);
  const code = new URL(consent.json<{ redirect: string }>().redirect).searchParams.get('code');
  const exchange = {
    grant_type: 'authorization_code',
    client_id: authorization.client_id,
    code,
    redirect_uri: authorization.redirect_uri,
    code_verifier: verifier,
    resource: authorization.resource,
  };
  expect(
    (
      await world.app.inject({
        method: 'POST',
        url: '/oauth/token',
        payload: { ...exchange, code_verifier: 'wrong'.repeat(11) },
      })
    ).statusCode,
  ).toBe(400);
  const token = await world.app.inject({ method: 'POST', url: '/oauth/token', payload: exchange });
  expect(
    token.statusCode,
    token.body + world.requestLog.filter((l) => l.includes('OAuth request failed')).join(''),
  ).toBe(200);
  expect(
    (await world.app.inject({ method: 'POST', url: '/oauth/token', payload: exchange })).statusCode,
  ).toBe(400);
  return { ...token.json(), client_id: authorization.client_id };
}
async function call(token: string, name: string, args: unknown = {}) {
  return world.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
}
it('OAuth → MCP: пароль и второй фактор, PKCE, одноразовый код, черновики только автора, подтверждение пачки', async () => {
  const token = await connect(admin);
  const initialized = await world.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'Inspector equivalent', version: '1' },
      },
    },
  });
  expect(initialized.statusCode, initialized.body).toBe(200);
  const listed = await world.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/json, text/event-stream',
    },
    payload: { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  });
  expect(
    listed
      .json()
      .result.tools.map((t: { name: string }) => t.name)
      .sort(),
  ).toEqual(['create_drafts', 'find_objects', 'find_people', 'list_meters']);
  const response = await call(token.access_token, 'create_drafts', {
    items: [
      { kind: 'note', title: 'Учебная заметка', body: 'Учебный текст' },
      { kind: 'object', title: 'Учебный объект' },
      { kind: 'contact', title: 'Учебный человек' },
    ],
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().result.isError).not.toBe(true);
  const inbox = await admin.get('/api/inbox');
  const rows = inbox
    .json<{ id: string; source: string; chatDraft: unknown }[]>()
    .filter((r) => r.source === 'chat');
  expect(rows).toHaveLength(3);
  const child = world.device();
  await child.signIn(world.vera.username, world.vera.password);
  expect((await child.get('/api/inbox')).json()).toHaveLength(0);
  const saved = await admin.post('/api/inbox/chat/confirm', { ids: rows.map((r) => r.id) });
  expect(saved.status, saved.text).toBe(200);
  expect((await admin.get('/api/inbox')).json()).toHaveLength(0);
  expect(
    (
      await world.database.admin.query('SELECT space_kind FROM notes WHERE title=$1', [
        'Учебная заметка',
      ])
    ).rows[0]?.space_kind,
  ).toBe('personal');
  expect(world.requestLog.join('')).not.toContain(token.access_token);
  expect(world.requestLog.join('')).not.toContain('Учебный текст');
});
it('матрица: ребёнок не видит Взрослые, взрослый не видит чужое личное; минимальные ответы', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const adultObject = await adult.post('/api/objects', {
    title: 'Только взрослым',
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  expect(adultObject.status, adultObject.text).toBe(201);
  await adult.post('/api/objects', { title: 'Чужое личное' });
  const child = world.device();
  await child.signIn(world.vera.username, world.vera.password);
  const token = await connect(child);
  const found = await call(token.access_token, 'find_objects');
  expect(found.statusCode, found.body).toBe(200);
  expect(found.body).not.toContain('Только взрослым');
  expect(found.body).not.toContain('Чужое личное');
  const a = await connect(admin);
  const visible = await call(a.access_token, 'find_objects');
  expect(visible.body).not.toContain('Чужое личное');
  const denied = await call(token.access_token, 'create_drafts', {
    items: [{ kind: 'task', title: 'Нельзя', objectId: adultObject.json().id }],
  });
  expect(denied.json().result.isError).toBe(true);
});
it('обновление, пределы, отзыв, 90 дней без использования и выключенный дом', async () => {
  const t = await connect(admin);
  const refresh = await world.app.inject({
    method: 'POST',
    url: '/oauth/token',
    payload: {
      grant_type: 'refresh_token',
      client_id: t.client_id,
      refresh_token: t.refresh_token,
    },
  });
  expect(refresh.statusCode, refresh.body).toBe(200);
  expect((await call(t.access_token, 'find_objects')).statusCode).toBe(401);
  const key = refresh.json().access_token;
  await world.database.admin.query(
    "UPDATE chat_grants SET access_expires_at=now()-interval '1 second' WHERE access_hash=$1",
    [hash(key)],
  );
  expect((await call(key, 'find_objects')).statusCode).toBe(401);
  await world.database.admin.query(
    "UPDATE chat_grants SET access_expires_at=now()+interval '1 hour' WHERE access_hash=$1",
    [hash(key)],
  );
  await world.database.admin.query(
    'UPDATE chat_grants SET minute=$1, minute_count=30 WHERE access_hash=$2',
    [Math.floor(Date.now() / 60000), hash(key)],
  );
  expect((await call(key, 'find_objects')).statusCode).toBe(429);
  await world.database.admin.query(
    "UPDATE chat_grants SET last_used_at=now()-interval '91 days' WHERE access_hash=$1",
    [hash(key)],
  );
  expect((await call(key, 'find_objects')).statusCode).toBe(401);
  const next = await connect(admin);
  await admin.post('/api/chat/settings', { id: world.houseId, enabled: false });
  expect((await call(next.access_token, 'find_objects')).statusCode).toBe(403);
  await admin.post('/api/chat/settings', { id: world.houseId, enabled: true });
  const devices = (await admin.get('/api/chat/devices')).json<{ id: string }[]>();
  for (const d of devices) await admin.post('/api/chat/revoke', { id: d.id });
  expect((await call(next.access_token, 'find_objects')).statusCode).toBe(401);
});
it('смена пароля и выход на всех устройствах отзывают ключи и незавершённые коды', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const t = await connect(adult);
  await world.database.auth.query(
    "UPDATE credentials SET password=password||'x' WHERE user_id=$1",
    [world.boris.id],
  );
  expect((await call(t.access_token, 'find_objects')).statusCode).toBe(401);
  const a = await connect(admin);
  expect((await admin.post('/api/auth/revoke-other-sessions', {})).status).toBe(200);
  expect((await call(a.access_token, 'find_objects')).statusCode).toBe(401);
});
it('дело со сроком, покупка и точное показание сохраняются только после подтверждения', async () => {
  const parent = await admin.post('/api/objects', {
    title: 'Учебная квартира',
    objectType: 'property',
  });
  expect(parent.status, parent.text).toBe(201);
  const meter = await admin.post(`/api/objects/${parent.json().id}/meters`, {
    data: { resource: 'cold_water', fractionDigits: 6 },
  });
  expect(meter.status, meter.text).toBe(201);
  const t = await connect(admin);
  const response = await call(t.access_token, 'create_drafts', {
    items: [
      {
        kind: 'task',
        title: 'Учебный срок',
        date: '2026-11-20',
        time: '10:30',
        objectId: parent.json().id,
        assigneeId: world.anna.id,
      },
      { kind: 'shopping', title: 'Учебная покупка', quantity: '2', body: 'Учебное примечание' },
      {
        kind: 'meter',
        title: 'Учебное показание',
        meterId: meter.json().id,
        values: ['123.456789'],
        date: '2026-10-01',
      },
    ],
  });
  expect(response.json().result.isError, response.body).not.toBe(true);
  expect(
    (
      await world.database.admin.query('SELECT id FROM meter_readings WHERE parent_id=$1', [
        meter.json().id,
      ])
    ).rowCount,
  ).toBe(0);
  const rows = (await admin.get('/api/inbox'))
    .json<{ id: string; source: string }[]>()
    .filter((r) => r.source === 'chat');
  const saved = await admin.post('/api/inbox/chat/confirm', { ids: rows.map((r) => r.id) });
  expect(saved.status, saved.text).toBe(200);
  const reading = await world.database.admin.query(
    'SELECT values::text FROM meter_readings WHERE parent_id=$1',
    [meter.json().id],
  );
  expect(reading.rows[0].values).toBe('{123.456789}');
  const task = await world.database.admin.query(
    'SELECT due_on::text,due_time FROM tasks WHERE title=$1',
    ['Учебный срок'],
  );
  expect(task.rows[0]).toEqual({ due_on: '2026-11-20', due_time: '10:30' });
  expect(
    (
      await world.database.admin.query('SELECT data FROM shopping_items WHERE title=$1', [
        'Учебная покупка',
      ])
    ).rows[0].data.note,
  ).toBe('Учебное примечание');
});
