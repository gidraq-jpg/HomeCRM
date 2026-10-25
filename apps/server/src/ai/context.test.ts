import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, notes, objects, recordLinks, spaces } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createWorld, type World } from '../testing/world.ts';
import { loadAiConfig } from './config.ts';

let world: World;
beforeAll(async () => {
  world = await createWorld();
});
afterAll(async () => {
  await world?.close();
});

it('AI-2: контекст под RLS, 50 самых используемых объектов, без чужого личного и взрослых у ребёнка', async () => {
  const publicObjects = Array.from({ length: 52 }, (_, index) => ({
    id: randomUUID(),
    title: `Учебный объект ${index}`,
    spaceId: world.houseId,
    audience: 'household' as const,
    spaceKind: 'household' as const,
    authorId: world.boris.id,
    updatedAt: new Date(index === 51 ? '2025-01-01' : '2026-10-01'),
  }));
  const used = publicObjects[51];
  if (!used) throw new Error('Missing fixture');
  await world.fixtures.insert(objects).values([
    ...publicObjects,
    {
      title: 'Личное Анны',
      spaceKind: 'personal',
      spaceId: world.anna.personalSpaceId,
      authorId: world.anna.id,
      audience: null,
    },
    {
      title: 'Только взрослые',
      spaceKind: 'household',
      spaceId: world.houseId,
      authorId: world.anna.id,
      audience: 'adults',
    },
    {
      title: 'Удалённое',
      spaceKind: 'household',
      spaceId: world.houseId,
      authorId: world.anna.id,
      audience: 'household',
      deletedAt: new Date(),
    },
  ]);
  const [note] = await world.fixtures
    .insert(notes)
    .values({
      title: 'Учебная связь',
      spaceKind: 'household',
      spaceId: world.houseId,
      authorId: world.boris.id,
      audience: 'household',
    })
    .returning();
  if (!note) throw new Error('Missing fixture');
  await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.insert(recordLinks).values({
      leftTable: 'objects',
      leftId: used.id,
      rightTable: 'notes',
      rightId: note.id,
      authorId: world.boris.id,
    }),
  );
  await world.fixtures.update(spaces).set({ aiEnabled: true }).where(eq(spaces.id, world.houseId));
  const directory = await mkdtemp(join(tmpdir(), 'homecrm-ai-context-'));
  const keyFile = join(directory, 'key');
  await writeFile(keyFile, randomBytes(32).toString('hex'));
  const contexts: { objects: string; members: string }[] = [];
  let healthCalls = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      healthCalls++;
      res.end(JSON.stringify({ ok: true, authPresent: true }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      contexts.push(JSON.parse(JSON.parse(body).messages[1].content[0].text).context);
      const field = (value: string) => ({ value, confident: true });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: field('Черновик'),
                  body: field('Ответ вымышленного поставщика'),
                }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const app = buildApp(
    { LOG_LEVEL: 'info', APP_VERSION: 'test' },
    {
      auth: world.module,
      logStream: { write: (line) => world.requestLog.push(line) },
      ai: loadAiConfig({
        AI_EXTRACT_PROVIDER: 'openai-compatible',
        AI_EXTRACT_URL: `http://127.0.0.1:${address.port}/v1`,
        AI_EXTRACT_KEY_FILE: keyFile,
      }),
    },
  );
  try {
    for (const person of [world.boris, world.vera]) {
      const device = world.device();
      await device.signIn(person.username, person.password);
      const headers = {
        cookie: [...device.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        origin: 'http://homecrm.test',
      };
      const payload = {
        kind: 'note',
        text: 'Учебная фраза',
        spaceId: world.houseId,
        consent: true,
      };
      for (let i = 0; i < 2; i++) {
        const status = await app.inject({
          method: 'GET',
          url: `/api/ai/status?spaceId=${world.houseId}`,
          headers,
        });
        expect(status.statusCode).toBe(200);
        expect(status.json().extraction).toBe(true);
        expect(status.json().provider).not.toContain(keyFile);
      }
      expect(healthCalls).toBe(1);
      expect(
        (await app.inject({ method: 'POST', url: '/api/ai/extract', headers, payload })).statusCode,
      ).toBe(200);
      const context = contexts.at(-1);
      expect(context?.objects.split('\n')).toHaveLength(50);
      expect(context?.objects.split('\n')[0]).toBe(`${used.id}: ${used.title}`);
      expect(context?.objects).not.toContain('Личное Анны');
      expect(context?.objects).not.toContain('Удалённое');
      if (person.role === 'child') expect(context?.objects).not.toContain('Только взрослые');
    }
    expect(world.requestLog.join('')).not.toContain('Ответ вымышленного поставщика');
    expect(world.requestLog.join('')).not.toContain('Учебная фраза');
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
