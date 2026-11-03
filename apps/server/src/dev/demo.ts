// D44: изолированный стенд, только вымышленная семья; секреты остаются в .demo.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createAppDatabase, createAuthDatabase, createWorkerDatabase } from '@homecrm/db';

const pg = createRequire(new URL('../../../../packages/db/package.json', import.meta.url))('pg');

import { createTestDatabase } from '@homecrm/db/testing';
import { createRoles } from '../../../../packages/db/src/bootstrap.ts';
import { aiProvider, loadAiConfig } from '../ai/config.ts';
import { buildApp } from '../app.ts';
import { createHousehold, provisionAccount } from '../auth/provision.ts';
import { createAuthModule } from '../auth/routes.ts';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';

const root = resolve(import.meta.dirname, '../../../..');
const local = resolve(root, '.demo');
await mkdir(local, { recursive: true });
const compose = resolve(local, 'compose.yaml');
await writeFile(
  compose,
  `services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
    ports: ["127.0.0.1:15500:5432"]
    tmpfs: [/var/lib/postgresql]
    healthcheck:
      test: [CMD, pg_isready, -U, postgres]
      interval: 1s
      retries: 60
`,
);
const project = 'homecrm-test-motion-template';
execFileSync('docker', ['compose', '-p', project, '-f', compose, 'up', '-d', '--wait'], {
  stdio: 'inherit',
});
const bootstrap = new pg.Client({
  connectionString: 'postgres://postgres@127.0.0.1:15500/postgres',
});
await bootstrap.connect();
await createRoles(bootstrap);
await bootstrap.end();
const database = await createTestDatabase('postgres://postgres@127.0.0.1:15500/postgres');
const origin = 'http://localhost:5360';
const auth = createAuthModule({
  db: createAuthDatabase(database.auth),
  appDb: createAppDatabase(database.app),
  secret: randomBytes(32).toString('base64url'),
  baseURL: origin,
  trustedOrigins: ['http://127.0.0.1:5360'],
});
const ai = loadAiConfig({ AI_EXTRACT_PROVIDER: 'fake', AI_STT_PROVIDER: 'fake' });
const app = buildApp(
  { LOG_LEVEL: 'silent', APP_VERSION: 'motion-template-demo' },
  {
    auth,
    worker: createWorkerDatabase(database.worker),
    ai,
    files: {
      storage: new DirectoryStorage(resolve(local, 'files')),
      cipher: new FileCipher(randomBytes(32), 1),
    },
  },
);
app.get('/api/demo/enter', async (_request, reply) => {
  reply.header(
    'set-cookie',
    signed.cookies.map((item) => `${item.name}=${item.value}; Path=/; HttpOnly; SameSite=Lax`),
  );
  return reply.redirect('/#/today/all');
});
const fixtures = createAuthDatabase(database.admin);
const houseId = await createHousehold(fixtures, 'Семья Солнечных — демонстрация');
const people = [];
for (const role of ['admin', 'adult', 'child'] as const) {
  const password = randomBytes(18).toString('base64url');
  const person = await provisionAccount(fixtures, {
    username: role,
    displayName: { admin: 'Анна', adult: 'Борис', child: 'Вера' }[role],
    password,
    householdId: houseId,
    role,
    ...(role === 'child' ? {} : { email: `${role}@family.test` }),
  });
  people.push({ ...person, role, username: role, password });
}
await writeFile(
  resolve(local, 'credentials.txt'),
  `${people.map((p) => `${p.username}: ${p.password}`).join('\n')}\n`,
  { mode: 0o600 },
);
await database.admin.query(
  'INSERT INTO notification_settings(account_id,first_entry_shown) SELECT id,true FROM accounts ON CONFLICT(account_id) DO UPDATE SET first_entry_shown=true',
);
const adult = people.find((p) => p.role === 'adult');
if (!adult) throw new Error('Demo participant missing');
const signed = await app.inject({
  method: 'POST',
  url: '/api/auth/sign-in/username',
  headers: { origin, 'content-type': 'application/json' },
  payload: { username: adult.username, password: adult.password },
});
if (signed.statusCode !== 200) throw new Error('Demo sign-in failed');
const cookie = signed.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
// Сессия только локально; нужна автоматическому входу в вымышленный стенд.
await writeFile(resolve(local, 'session.json'), JSON.stringify(signed.cookies), { mode: 0o600 });
async function post(path: string, payload: object) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/${path}`,
    headers: { origin, cookie },
    payload,
  });
  if (res.statusCode !== 201 && res.statusCode !== 200)
    throw new Error(`Demo seed ${path.split('/')[0]}: ${res.statusCode}`);
  return res.json();
}
const placement = { spaceId: houseId, audience: 'household' };
const objects = [];
for (const title of [
  'Квартира Солнечных',
  'Дача у озера',
  'Семейный автомобиль',
  'Стиральная машина',
])
  objects.push(
    await post('objects', {
      title,
      objectType: objects.length < 2 ? 'property' : 'other',
      placement,
    }),
  );
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Yekaterinburg' });
for (let i = 0; i < 15; i++) {
  await post('tasks', {
    title: `${
      [
        'Полить цветы',
        'Проверить фильтр',
        'Разобрать полку',
        'Забрать посылку',
        'Записаться к мастеру',
      ][i % 5]
    } · ${i + 1}`,
    planOn: today,
    status: (['open', 'done', 'cancelled'] as const)[i % 3],
    placement,
  });
  await post('shopping', {
    title: `${['Яблоки', 'Молоко', 'Хлеб', 'Чай', 'Рис'][i % 5]} · ${i + 1}`,
    placement,
  });
  await post('notes', {
    title: `Идея для дома ${i + 1}`,
    body: 'Вымышленная заметка для проверки переходов и длинных форм.',
    placement,
  });
  await post('contacts', { title: `Мастер Солнечный ${i + 1}`, kind: 'person', placement });
  await post('documents', {
    title: `Учебный договор ${i + 1}`,
    data: { type: 'other' },
    placement,
  });
}
const meter = await post(`objects/${objects[0].id}/meters`, {
  title: 'Холодная вода',
  data: { resource: 'cold_water', serialNumber: 'DEMO-001' },
  initialReading: { occurredOn: '2026-09-20', values: ['100.000'] },
});
await post(`meters/${meter.id}/readings`, { occurredOn: '2026-10-20', values: ['110.000'] });
await database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [houseId]);
for (let i = 0; i < 3; i++) {
  const id = randomUUID();
  await post('inbox', {
    id,
    idempotencyKey: id,
    ownerAccountId: adult.id,
    offline: true,
    source: 'text',
    text: `Заметка: вымышленный план для дачи ${i + 1}`,
    houseId,
    consent: null,
  });
  await post(`inbox/${id}/parse`, { consent: `v4:${aiProvider(ai)}` });
}
await app.listen({ host: '127.0.0.1', port: 8500 });
const vite = spawn(
  process.execPath,
  [resolve(root, 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
  {
    cwd: resolve(root, 'apps/web'),
    env: { ...process.env, PORT: '8500', WEB_PORT: '5360', HOMECRM_DEMO: '1' },
    stdio: 'inherit',
  },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  vite.kill();
  await app.close();
  await database.drop();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
console.log(
  'Motion template demo ready: http://localhost:5360; credentials are in .demo/credentials.txt',
);
