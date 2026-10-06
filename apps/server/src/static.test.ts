import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

let root: string;
let secretOutside: string;

beforeAll(() => {
  const parent = mkdtempSync(join(tmpdir(), 'homecrm-static-'));
  root = join(parent, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<html>shell</html>');
  writeFileSync(join(root, 'sw.js'), 'self.skipWaiting()');
  writeFileSync(join(root, 'manifest.webmanifest'), '{}');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  secretOutside = join(parent, 'secret.txt');
  writeFileSync(secretOutside, 'must not be served');
});

afterAll(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

const build = () => buildApp({ LOG_LEVEL: 'silent', APP_VERSION: 'test' }, { staticDir: root });

describe('раздача клиента', () => {
  it('отдаёт файл сборки с типом и кэшем: хэшированный навсегда, оболочка — с проверкой', async () => {
    const app = build();
    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');
    const worker = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(worker.headers['cache-control']).toBe('no-cache');
    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    await app.close();
  });

  it('возвращает index.html для /, /invite/… и /reset-password (ADR-0008)', async () => {
    const app = build();
    for (const url of ['/', '/invite/abc', '/reset-password?token=x', '/notes/some/deep/route']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body).toContain('shell');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
    await app.close();
  });

  it('API, /health, несуществующие файлы и чужие методы остаются обычным 404', async () => {
    const app = build();
    const api = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ code: 'NOT_FOUND' });
    const missing = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missing.statusCode).toBe(404);
    const post = await app.inject({ method: 'POST', url: '/invite/abc' });
    expect(post.statusCode).toBe(404);
    await app.close();
  });

  it('не выходит за папку клиента', async () => {
    const app = build();
    for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%00']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.body, url).not.toContain('must not be served');
    }
    await app.close();
  });

  it('HEAD отвечает без тела', async () => {
    const app = build();
    const response = await app.inject({ method: 'HEAD', url: '/invite/abc' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    await app.close();
  });

  it('без staticDir всё, чего нет, — 404', async () => {
    const app = buildApp({ LOG_LEVEL: 'silent', APP_VERSION: 'test' });
    const response = await app.inject({ method: 'GET', url: '/invite/abc' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /health с проверкой базы', () => {
  it('база отвечает: ok и database ok', async () => {
    const app = buildApp(
      { LOG_LEVEL: 'silent', APP_VERSION: 'test' },
      { checkDatabase: async () => {} },
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok' });
    await app.close();
  });

  it('база не отвечает: 503 без текста ошибки', async () => {
    const app = buildApp(
      { LOG_LEVEL: 'silent', APP_VERSION: 'test' },
      {
        checkDatabase: async () => {
          throw new Error('connect ECONNREFUSED postgres://user:secret@db/homecrm');
        },
      },
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'down' });
    expect(response.body).not.toContain('secret');
    await app.close();
  });
});
