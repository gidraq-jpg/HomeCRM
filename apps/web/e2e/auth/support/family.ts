import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { createAppDatabase, createAuthDatabase, createWorkerDatabase } from '@homecrm/db';
import { createTestDatabase } from '@homecrm/db/testing';
import type { Role } from '@homecrm/shared';
import { buildApp } from '../../../../server/src/app.ts';
import { createHousehold, provisionAccount } from '../../../../server/src/auth/provision.ts';
import { createAuthModule } from '../../../../server/src/auth/routes.ts';
import { FileCipher } from '../../../../server/src/files/crypto.ts';
import { DirectoryStorage } from '../../../../server/src/files/storage.ts';
import { currentCode } from '../../../../server/src/testing/totp.ts';
import { E2E_PREFIX } from '../../support/static-server.ts';

const ROOT = resolve(import.meta.dirname, '../../../dist');
// Зашифрованные файлы сценария лежат в test-results (в git не попадает); главный ключ — случайный,
// только в памяти этого прогона: ни рабочий ключ, ни рабочие данные не используются.
const FILES_ROOT = resolve(import.meta.dirname, '../../../test-results/files');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export async function createFamily() {
  const adminUrl = process.env.HOMECRM_TEST_PG_ADMIN_URL;
  if (!adminUrl) throw new Error('E2E PostgreSQL is not configured');
  const database = await createTestDatabase(adminUrl);
  let upstream = '';
  // HTTP-прокси и статика на своём свободном порту. Cookie проходят через настоящий браузер.
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        headers.delete('host');
        headers.delete('content-length');
        const result = await fetch(`${upstream}${url.pathname}${url.search}`, {
          method: request.method,
          headers,
          redirect: 'manual',
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        result.headers.forEach((value, key) => {
          if (key !== 'set-cookie' && key !== 'content-encoding') response.setHeader(key, value);
        });
        const cookies = result.headers.getSetCookie();
        if (cookies.length) response.setHeader('set-cookie', cookies);
        response.statusCode = result.status;
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      const relative = url.pathname.startsWith(E2E_PREFIX)
        ? url.pathname.slice(E2E_PREFIX.length)
        : url.pathname.slice(1);
      const route = !relative || !extname(relative);
      const file = resolve(ROOT, route ? 'index.html' : relative);
      if (!file.startsWith(ROOT + sep)) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(content);
    } catch {
      response
        .writeHead(502, { 'content-type': 'application/json' })
        .end('{"code":"TEST_UPSTREAM_FAILED"}');
    }
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const module = createAuthModule({
    db: createAuthDatabase(database.auth),
    appDb: createAppDatabase(database.app),
    secret: randomBytes(32).toString('base64url'),
    baseURL: origin,
  });
  // Обработчик передачи ответственности нужен уходу из дома и исключению (docs/household-api.md).
  await mkdir(FILES_ROOT, { recursive: true });
  const filesDir = await mkdtemp(resolve(FILES_ROOT, 'run-'));
  const app = buildApp(
    { LOG_LEVEL: 'silent', APP_VERSION: 'e2e' },
    {
      auth: module,
      worker: createWorkerDatabase(database.worker),
      files: {
        storage: new DirectoryStorage(filesDir),
        cipher: new FileCipher(randomBytes(32), 1),
      },
    },
  );
  // В конце сценария соединения прокси уже не нужны, в том числе прерванные офлайном.
  app.addHook('preClose', async () => {
    app.server.closeAllConnections();
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  upstream = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const fixtures = createAuthDatabase(database.admin);
  const houseId = await createHousehold(fixtures, 'Вымышленный дом');
  const people = await Promise.all(
    (['admin', 'adult', 'child'] as const).map(async (role: Role) => {
      const password = randomBytes(18).toString('base64url');
      const person = await provisionAccount(fixtures, {
        username: role,
        displayName: { admin: 'Анна', adult: 'Борис', child: 'Вера' }[role],
        password,
        householdId: houseId,
        role,
        ...(role === 'child' ? {} : { email: `${role}@family.test` }),
      });
      return { ...person, role, username: role, password };
    }),
  );
  const person = (role: Role) => {
    const found = people.find((p) => p.role === role);
    if (!found) throw new Error('Missing fictional participant');
    return found;
  };
  return {
    origin,
    baseURL: `${origin}${E2E_PREFIX}`,
    database,
    person,
    houseId,
    async post(path: string, body: unknown, cookie = '') {
      return fetch(`${origin}/api/${path}`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    async enroll(role: Role) {
      const account = person(role);
      const signed = await fetch(`${origin}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: role, password: account.password }),
      });
      const cookie = signed.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const enabled = await this.post(
        'auth/two-factor/enable',
        { password: account.password },
        cookie,
      );
      if (enabled.status !== 200) throw new Error('Test enrollment failed');
      const data = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
      const verified = await this.post(
        'auth/two-factor/verify-totp',
        { code: currentCode(data.totpURI) },
        cookie,
      );
      if (verified.status !== 200) throw new Error('Test TOTP verification failed');
      await database.admin.query("DELETE FROM verifications WHERE identifier LIKE 'totp-used:%'");
      return data;
    },
    async close() {
      await new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        // После офлайна Chromium может оставить соединения; сценарий уже закончен.
        server.closeAllConnections();
      });
      await app.close();
      await database.drop();
      await rm(filesDir, { recursive: true, force: true });
    },
  };
}
export type Family = Awaited<ReturnType<typeof createFamily>>;
