// Статический сервер для сквозных тестов: отдаёт собранный `dist` не из корня, а из подпапки.
// Так проверяется условие задачи 0.5: сборка работает из любой папки, без привязки к корню
// сайта и без сервера приложения. Запросы вне подпапки получают 404 — любой абсолютный путь
// в сборке («/assets/…») сразу бы сломал страницу.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { argv, env } from 'node:process';

export const E2E_PORT = Number(env.E2E_PORT ?? 5194);
export const E2E_PREFIX = env.E2E_PREFIX ?? '/homecrm/prototype/v1/';

const ROOT = resolve(import.meta.dirname, '../../dist');

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export function startStaticServer(port: number = E2E_PORT, prefix: string = E2E_PREFIX) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(prefix)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found: the prototype is served only under its sub-folder');
      return;
    }
    const relative = path.slice(prefix.length) || 'index.html';
    const file = normalize(join(ROOT, relative));
    if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Static server: http://127.0.0.1:${port}${prefix}`);
  });
  return server;
}

// Запуск как отдельного процесса: `node e2e/support/static-server.ts`.
if (import.meta.filename === resolve(argv[1] ?? '')) {
  startStaticServer();
}
