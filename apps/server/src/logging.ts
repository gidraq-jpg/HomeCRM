// Журнал запросов без секретов (AGENTS.md, правило 1). Ссылки-приглашения и сброса пароля несут
// одноразовый токен прямо в адресе: `/invite/<токен>`, `/reset-password?token=…`, а ссылка из письма
// библиотеки — `/api/auth/reset-password/<токен>`. В журнал Fastify адрес попадает на каждый запрос,
// поэтому токен вырезается до записи.
import type { FastifyRequest } from 'fastify';

const SECRET_PATHS = [
  /^(\/invite\/)[^/?#]+/,
  /^(\/reset-password\/)[^/?#]+/,
  /^(\/api\/auth\/reset-password\/)[^/?#]+/,
];
const SECRET_QUERY = /([?&]token=)[^&#]*/gi;

export const REDACTED = '[redacted]';

export function redactUrl(url: string): string {
  if (/^\/api\/search(?:\/|[?#]|$)/.test(url)) return '/api/search';
  if (
    /^\/api\/(notes|objects|links|records|contacts|accounts|meters|readings|documents|tasks|deadlines)(?:\/|[?#]|$)/.test(
      url,
    )
  ) {
    const allowed = new Set([
      'documents',
      'tasks',
      'status',
      'deadlines',
      'today',
      'plan',
      'main',
      'undo',
      'series',
      'from-radar',
      'task_file',
      'versions',
      'history',
      'files',
      'move',
      'assignee',
      'renew',
      'analytics',
      'api',
      'notes',
      'objects',
      'links',
      'records',
      'contacts',
      'import',
      'interactions',
      'accounts',
      'meters',
      'readings',
      'replace',
      'transmission',
      'transmit',
      'contact',
      'utility_account',
      'meter',
      'meter_reading',
      'timeline',
      'events',
      'export',
      'object',
      'note',
      'note_item',
      'object_field',
      'object_event',
      'task',
      'shopping_item',
      'share',
      'personal',
      'copy',
      'audience',
      'trash',
      'restore',
      'access-preview',
    ]);
    return (
      url
        .split(/[?#]/)[0]
        ?.split('/')
        .map((part) =>
          !part || allowed.has(part) || /^[a-f0-9-]{36}$/i.test(part) ? part : REDACTED,
        )
        .join('/') ?? '/api/notes'
    );
  }
  let result = url;
  for (const pattern of SECRET_PATHS) result = result.replace(pattern, `$1${REDACTED}`);
  return result.replace(SECRET_QUERY, `$1${REDACTED}`);
}

/** Сериализатор запроса для pino: то же, что в Fastify по умолчанию, но с вырезанным токеном в адресе. */
export function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
