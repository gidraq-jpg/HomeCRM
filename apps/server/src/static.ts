// Раздача собранного клиента рядом с API под одним адресом (ADR-0008, ADR-0015).
// Свой небольшой обработчик вместо отдельной зависимости: нужны только файлы из одной папки и
// возврат index.html для адресов приложения (/invite/…, /reset-password, остальные маршруты клиента).
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
};

/** Адреса сервера: на них клиентский index.html не подставляется, а ответом остаётся 404 в JSON. */
const SERVER_PATHS = /^\/(api|health)(\/|$)/;

function allowedPath(path: string): boolean {
  return !path
    .split(/[\\/]/)
    .some((part) => part.startsWith('.') || /\.(?:ts|tsx|map)$|\.env.*$/i.test(part));
}

function insideRoot(base: string, target: string): boolean {
  const path = relative(base, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

/** null — путь запрещён; undefined — файла нет. Запрещённое не превращается в маршрут клиента. */
async function fileInfo(
  base: string,
  path: string,
): Promise<{ path: string; size: number } | null | undefined> {
  try {
    const target = await realpath(path);
    if (!insideRoot(base, target) || !allowedPath(relative(base, target))) return null;
    const info = await stat(target);
    return info.isFile() ? { path: target, size: info.size } : undefined;
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
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return false;

    const requested = decoded.replace(/^\/+/, '');
    if (!allowedPath(requested)) return false;
    let realBase: string;
    try {
      realBase = await realpath(base);
    } catch {
      return false;
    }
    const candidate = resolve(join(realBase, requested));
    if (!insideRoot(realBase, candidate)) return false;
    let file = requested === '' ? undefined : await fileInfo(realBase, candidate);
    if (file === null) return false;
    let servedRelative = requested;
    if (file === undefined) {
      // Файл с расширением, которого нет, — это 404, а не маршрут клиента.
      if (extname(decoded) !== '') return false;
      servedRelative = 'index.html';
      file = await fileInfo(realBase, join(realBase, 'index.html'));
      if (file == null) return false;
    }

    void reply
      .header('content-type', TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream')
      .header('content-length', file.size)
      .header('cache-control', cacheControl(servedRelative))
      .header('x-content-type-options', 'nosniff');
    await reply.send(request.method === 'HEAD' ? '' : createReadStream(file.path));
    return true;
  };
}
