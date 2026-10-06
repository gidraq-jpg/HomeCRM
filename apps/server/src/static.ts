// Раздача собранного клиента рядом с API под одним адресом (ADR-0008, ADR-0015).
// Свой небольшой обработчик вместо отдельной зависимости: нужны только файлы из одной папки и
// возврат index.html для адресов приложения (/invite/…, /reset-password, остальные маршруты клиента).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Адреса сервера: на них клиентский index.html не подставляется, а ответом остаётся 404 в JSON. */
const SERVER_PATHS = /^\/(api|health)(\/|$)/;

async function fileInfo(path: string): Promise<{ size: number } | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size } : undefined;
  } catch {
    return undefined;
  }
}

function cacheControl(relative: string): string {
  // Файлы с хэшем в имени не меняются; оболочка и service worker проверяются на каждой загрузке.
  return relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * Обработчик «ничего не нашлось» для GET и HEAD: файл из папки клиента, иначе index.html для
 * адресов приложения. Для /api и /health, для файлов с расширением и для остальных методов — null:
 * вызывающий отвечает обычным 404.
 */
export function createStaticHandler(root: string) {
  const base = resolve(root);
  return async function serve(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const pathname = request.url.split('?')[0] ?? '/';
    if (SERVER_PATHS.test(pathname)) return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (decoded.includes('\0')) return false;

    const relative = decoded.replace(/^\/+/, '');
    const candidate = resolve(join(base, relative));
    const inside = candidate === base || candidate.startsWith(base + sep);
    let file = relative === '' || !inside ? undefined : await fileInfo(candidate);
    let target = candidate;
    let servedRelative = relative;
    if (file === undefined) {
      // Файл с расширением, которого нет, — это 404, а не маршрут клиента.
      if (extname(decoded) !== '') return false;
      target = join(base, 'index.html');
      servedRelative = 'index.html';
      file = await fileInfo(target);
      if (file === undefined) return false;
    }

    void reply
      .header('content-type', TYPES[extname(target)] ?? 'application/octet-stream')
      .header('content-length', file.size)
      .header('cache-control', cacheControl(servedRelative))
      .header('x-content-type-options', 'nosniff');
    await reply.send(request.method === 'HEAD' ? '' : createReadStream(target));
    return true;
  };
}
