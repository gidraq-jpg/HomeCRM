import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadAiConfig } from './config.ts';
import { createProviders, type ExtractRequest, fakeDraft, validateAudio } from './providers.ts';

const input: ExtractRequest = {
  kind: 'note',
  text: 'Вымышленный текст для проверки',
  context: { objects: [], members: [], timeZone: 'UTC' },
};
let server: Server;
let directory: string;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
  if (server)
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(handler: RequestListener, ms = 1000) {
  directory = await mkdtemp(join(tmpdir(), 'homecrm-ai-'));
  const key = randomBytes(32).toString('hex');
  await writeFile(join(directory, 'key'), key);
  server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server');
  const url = `http://127.0.0.1:${address.port}`;
  const providers = createProviders(
    loadAiConfig({
      AI_STT_PROVIDER: 'local-stt',
      AI_STT_URL: url,
      AI_EXTRACT_PROVIDER: 'openai-compatible',
      AI_EXTRACT_URL: `${url}/v1`,
      AI_EXTRACT_KEY_FILE: join(directory, 'key'),
    }),
    { speech: ms, extraction: ms },
  );
  close = providers.close;
  return { ...providers, key };
}
it('AI: без настроек провайдеры выключены; неверный URL не раскрывается', async () => {
  const p = createProviders(loadAiConfig({}));
  expect(await p.speech.health()).toBe(false);
  expect(await p.extractor.health()).toBe(false);
  await expect(p.extractor.extract(input)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  expect(() => loadAiConfig({ AI_STT_URL: 'invalid' })).toThrow('Invalid AI configuration');
  await p.close();
});
it('AI: совместимый ответ проходит схему; запрос содержит json_schema', async () => {
  let structured = false;
  const p = await setup((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      structured = Boolean(JSON.parse(body).response_format);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fakeDraft(input)) } }] }),
      );
    });
  });
  expect(await p.extractor.extract(input)).toEqual(fakeDraft(input));
  expect(structured).toBe(true);
});
it('AI-2: провайдер отправляет короткий контекст, а не внутренние данные', async () => {
  const p = await setup((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const sent = JSON.parse(JSON.parse(body).messages[1].content[0].text);
      expect(Object.keys(sent.context)).toEqual(['today', 'members', 'objects']);
      expect(sent.context.today).toBe('2026-10-24 суббота');
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fakeDraft(input)) } }] }),
      );
    });
  });
  await p.extractor.extract({
    ...input,
    context: {
      ...input.context,
      now: new Date('2026-10-23T22:30:00Z'),
      timeZone: 'Asia/Yekaterinburg',
    },
  });
});
it('AI: неверная схема повторяется один раз; содержимое ответа не попадает в ошибку', async () => {
  let calls = 0;
  const p = await setup((_req, res) => {
    calls++;
    res.end(
      JSON.stringify({ choices: [{ message: { content: 'sensitive malformed response' } }] }),
    );
  });
  await expect(p.extractor.extract(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  expect(calls).toBe(2);
});
it('AI: отказ авторизации не раскрывает ключ или текст', async () => {
  const p = await setup((_req, res) => {
    res.statusCode = 401;
    res.end('provider secret');
  });
  try {
    await p.extractor.extract(input);
    throw new Error('expected failure');
  } catch (error) {
    const text = String(error);
    expect(text.includes(p.key)).toBe(false);
    expect(text.includes(input.text ?? '')).toBe(false);
    expect(text).toContain('AI_UNAVAILABLE');
  }
});
it('AI-6: занятость поставщика отличается от выключенного компьютера', async () => {
  const p = await setup((_req, res) => {
    res.statusCode = 429;
    res.end();
  });
  await expect(p.extractor.extract(input)).rejects.toMatchObject({ status: 429, code: 'AI_BUSY' });
});
it('AI: тайм-аут ограничен, один сетевой повтор', async () => {
  let calls = 0;
  const p = await setup(() => {
    calls++;
  }, 20);
  await expect(p.extractor.extract(input)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  expect(calls).toBe(2);
});
it('AI: паспорт, медицина и document отклоняются до HTTP', async () => {
  let calls = 0;
  const p = await setup(() => {
    calls++;
  });
  for (const classification of ['passport', 'medical'] as const)
    await expect(
      p.extractor.extract({ ...input, image: { bytes: Buffer.from('fiction'), classification } }),
    ).rejects.toMatchObject({ code: 'AI_PRIVATE_DOCUMENT' });
  await expect(
    p.extractor.extract({ ...input, kind: 'document' as ExtractRequest['kind'] }),
  ).rejects.toMatchObject({ code: 'AI_PRIVATE_DOCUMENT' });
  expect(calls).toBe(0);
});
it('AI: local-stt передаёт multipart file, проверяет ответ и длительность', async () => {
  let multipart = false;
  const p = await setup((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      multipart = body.includes('name="file"');
      res.end(JSON.stringify({ text: 'Образец', duration: 1 }));
    });
  });
  expect(
    await p.speech.transcribe(
      { bytes: Buffer.from('fiction'), mime: 'audio/wav', durationMs: 1000 },
      { lang: 'ru' },
    ),
  ).toEqual({ text: 'Образец', durationMs: 1000 });
  expect(multipart).toBe(true);
  expect(() =>
    validateAudio({ bytes: Buffer.alloc(1), mime: 'audio/wav', durationMs: 120001 }),
  ).toThrow('AI_INVALID_AUDIO');
});

it('AI: после отказа json_schema остаётся один повтор неверной схемы', async () => {
  let calls = 0;
  const p = await setup((_req, res) => {
    calls++;
    if (calls === 1) {
      res.statusCode = 400;
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { content: calls === 2 ? '{}' : JSON.stringify(fakeDraft(input)) } }],
      }),
    );
  });
  expect(await p.extractor.extract(input)).toEqual(fakeDraft(input));
  expect(calls).toBe(3);
});

it('AI: изображение преобразуется в JPEG до 1600 px', async () => {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  let image: Buffer | undefined;
  const p = await setup((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body);
      const item = payload.messages[1].content.find(
        (c: { type: string }) => c.type === 'image_url',
      );
      image = Buffer.from(item.image_url.url.split(',')[1], 'base64');
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fakeDraft(input)) } }] }),
      );
    });
  });
  await p.extractor.extract({ ...input, image: { bytes, classification: 'ordinary' } });
  const meta = await sharp(image).metadata();
  expect(meta.format).toBe('jpeg');
  expect(meta.width).toBe(1600);
  expect(meta.height).toBe(800);
});
it('AI: local-stt отклоняет неверную схему ответа', async () => {
  const p = await setup((_req, res) => res.end(JSON.stringify({ text: 'sample', duration: 121 })));
  await expect(
    p.speech.transcribe(
      { bytes: Buffer.from('fiction'), mime: 'audio/wav', durationMs: 1000 },
      { lang: 'ru' },
    ),
  ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
});
