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
afterAll(async () => {
  await world?.close();
});
it('AI: выключенный дом запрещает разбор, настройку меняет только администратор; журналы без текста', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const body = { spaceId: world.houseId, kind: 'note', text: 'Секретный вымышленный образец D24' };
  expect((await adult.post('/api/ai/extract', body)).status).toBe(403);
  expect(
    (
      await adult.request('PATCH', '/api/ai/settings', {
        json: { spaceId: world.houseId, enabled: true },
      })
    ).status,
  ).toBe(403);
  const { device } = await signedInAdmin(world);
  expect(
    (
      await device.request('PATCH', '/api/ai/settings', {
        json: { spaceId: world.houseId, enabled: true },
      })
    ).status,
  ).toBe(200);
  expect((await adult.get(`/api/ai/status?spaceId=${world.houseId}`)).status).toBe(200);
  expect((await adult.post('/api/ai/extract', { ...body, kind: 'document' })).status).toBe(400);
  const app = buildApp(
    { LOG_LEVEL: 'info', APP_VERSION: 'test' },
    {
      auth: world.module,
      ai: loadAiConfig({ AI_STT_PROVIDER: 'fake', AI_EXTRACT_PROVIDER: 'fake' }),
      logStream: { write: (line) => world.requestLog.push(line) },
    },
  );
  await app.ready();
  // Тот же cookie устройства, поддельный поставщик; логи не содержат запрос/черновик.
  const response = await app.inject({
    method: 'POST',
    url: '/api/ai/extract',
    headers: {
      cookie: [...adult.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: 'http://homecrm.test',
    },
    payload: body,
  });
  expect(response.statusCode).toBe(200);
  const form = new FormData();
  form.set(
    'file',
    new Blob([await readFile(new URL('./eval/samples/speech-0.wav', import.meta.url))], {
      type: 'audio/wav',
    }),
    'sample.wav',
  );
  const multipart = new Response(form);
  const transcribed = await app.inject({
    method: 'POST',
    url: `/api/ai/transcribe?spaceId=${world.houseId}`,
    headers: {
      cookie: [...adult.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: 'http://homecrm.test',
      'content-type': multipart.headers.get('content-type') ?? '',
    },
    payload: Buffer.from(await multipart.arrayBuffer()),
  });
  expect(transcribed.statusCode).toBe(200);
  expect(transcribed.json()).toEqual({ text: 'Вымышленный образец' });
  expect(world.requestLog.join('').includes(body.text)).toBe(false);
  await app.close();
});
