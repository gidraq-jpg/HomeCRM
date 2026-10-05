// Заглушка этапа 0 (план, задача 0.2; ADR-0018).
// Публичный порт (PORT) отдаёт страницу проверки и её API — его пробрасывает туннель.
// Служебный порт (ADMIN_PORT) показывает результаты; он публикуется только на 127.0.0.1
// этого компьютера и через туннель не пробрасывается.
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import webpush from 'web-push';
import {
  cleanLabel,
  escapeHtml,
  MAX_BLOB_BYTES,
  MAX_JSON_BYTES,
  NETWORK_LABELS,
  NETWORKS,
  parseBlobSize,
  parseDelay,
  parseNetwork,
  parseSubscription,
} from './probe.ts';
import { openStore, type ProbeEvent } from './store.ts';

const env = process.env;
const HOST = env.HOST ?? '127.0.0.1';
const PORT = Number(env.PORT ?? 8300);
const ADMIN_PORT = Number(env.ADMIN_PORT ?? 8309);
const DATA_DIR = env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');
const DISPLAY_TZ = env.DISPLAY_TZ ?? 'Europe/Moscow';
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const PUSH_LIMIT_PER_HOUR = 30;

const vapid =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }
    : null;

const store = openStore(DATA_DIR);
const blob = randomBytes(MAX_BLOB_BYTES);
const pushTimers = new Set<NodeJS.Timeout>();
const pushRequests = new Map<string, number[]>();

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

// --- Ответы ---------------------------------------------------------------

const PUBLIC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; " +
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'none'",
};
const ADMIN_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  headers: Record<string, string> = PUBLIC_HEADERS,
): void {
  res.writeHead(status, {
    ...headers,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, value: unknown): void =>
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');

/** Читает тело запроса; null — если оно больше предела (соединение тогда закрывается). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, MAX_JSON_BYTES);
  if (body === null) return null;
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// --- Статика ----------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};
const staticFiles = new Map<string, { body: Buffer; type: string }>();
for (const name of readdirSync(PUBLIC_DIR)) {
  const type = CONTENT_TYPES[extname(name)];
  if (type !== undefined)
    staticFiles.set(name, { body: readFileSync(join(PUBLIC_DIR, name)), type });
}

// --- Push -------------------------------------------------------------------

function allowPush(subscriptionId: string): boolean {
  const hourAgo = Date.now() - 3_600_000;
  const recent = (pushRequests.get(subscriptionId) ?? []).filter((t) => t > hourAgo);
  if (recent.length >= PUSH_LIMIT_PER_HOUR) return false;
  recent.push(Date.now());
  pushRequests.set(subscriptionId, recent);
  return true;
}

function schedulePush(subscriptionId: string, delaySec: number): string {
  const pushId = randomUUID();
  const timer = setTimeout(async () => {
    pushTimers.delete(timer);
    const record = store.subscriptions.get(subscriptionId);
    if (record === undefined || vapid === null) return;
    const sentAt = Date.now();
    let status: number | null = null;
    let error: string | undefined;
    try {
      const result = await webpush.sendNotification(
        record.subscription,
        JSON.stringify({ pushId, sentAt }),
        { TTL: 3600, urgency: 'high', vapidDetails: vapid },
      );
      status = result.statusCode;
    } catch (caught) {
      status = caught instanceof webpush.WebPushError ? caught.statusCode : null;
      error = caught instanceof Error ? caught.message.slice(0, 200) : 'unknown error';
    }
    store.append({
      type: 'push-sent',
      at: new Date(sentAt).toISOString(),
      pushId,
      subscriptionId,
      label: record.label,
      delaySec,
      status,
      ...(error === undefined ? {} : { error }),
    });
    log(error === undefined ? 'info' : 'warn', 'push sent', { status, delaySec });
  }, delaySec * 1000);
  pushTimers.add(timer);
  return pushId;
}

// --- Публичная часть --------------------------------------------------------

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname.slice('/probe/api/'.length)}`;
  switch (route) {
    case 'GET ping':
      return sendJson(res, 200, { t: Date.now() });

    case 'GET info':
      return sendJson(res, 200, {
        serverTime: Date.now(),
        vapidPublicKey: vapid?.publicKey ?? null,
        networks: NETWORKS.map((id) => ({ id, label: NETWORK_LABELS[id] })),
      });

    case 'GET blob': {
      const size = parseBlobSize(url.searchParams.get('size'));
      if (size === null) return sendJson(res, 400, { error: 'size' });
      return send(res, 200, blob.subarray(0, size), 'application/octet-stream');
    }

    case 'POST upload': {
      const started = Date.now();
      const body = await readBody(req, MAX_BLOB_BYTES);
      if (body === null) return;
      return sendJson(res, 200, { bytes: body.length, ms: Date.now() - started });
    }

    case 'POST subscribe': {
      const body = await readJson(req);
      const subscription = parseSubscription(body?.subscription);
      if (body === null || subscription === null)
        return sendJson(res, 400, { error: 'subscription' });
      const label = cleanLabel(body.label);
      for (const record of store.subscriptions.values()) {
        if (record.subscription.endpoint === subscription.endpoint && record.label === label) {
          return sendJson(res, 200, { id: record.id });
        }
      }
      const id = randomUUID();
      const ok = store.append({
        type: 'subscription',
        id,
        at: new Date().toISOString(),
        label,
        subscription,
      });
      return ok ? sendJson(res, 200, { id }) : sendJson(res, 507, { error: 'full' });
    }

    case 'POST push-test': {
      if (vapid === null) return sendJson(res, 503, { error: 'push-not-configured' });
      const body = await readJson(req);
      const delaySec = parseDelay(body?.delaySec);
      const id = typeof body?.id === 'string' ? body.id : '';
      if (delaySec === null || !store.subscriptions.has(id))
        return sendJson(res, 400, { error: 'request' });
      if (!allowPush(id)) return sendJson(res, 429, { error: 'too-many' });
      const pushId = schedulePush(id, delaySec);
      return sendJson(res, 202, { pushId, sendAt: Date.now() + delaySec * 1000 });
    }

    case 'POST push-ack': {
      const body = await readJson(req);
      const pushId = typeof body?.pushId === 'string' ? body.pushId : '';
      const sentAt = store.sentAt(pushId);
      if (sentAt === undefined) return sendJson(res, 404, { error: 'push' });
      const receivedAt = typeof body?.receivedAt === 'number' ? body.receivedAt : null;
      store.append({
        type: 'push-ack',
        at: new Date().toISOString(),
        pushId,
        phoneLatencyMs: receivedAt === null ? null : receivedAt - sentAt,
        serverLatencyMs: Date.now() - sentAt,
      });
      return sendJson(res, 200, { ok: true });
    }

    case 'POST result': {
      const body = await readJson(req);
      if (body === null) return sendJson(res, 400, { error: 'result' });
      const data = {
        ...body,
        label: cleanLabel(body.label),
        network: parseNetwork(body.network) ?? 'unknown',
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      };
      const ok = store.append({ type: 'result', at: new Date().toISOString(), data });
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 507, { error: 'full' });
    }

    default:
      return sendJson(res, 404, { error: 'not-found' });
  }
}

async function handlePublic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://probe.invalid');
  const path = url.pathname;
  if (req.method === 'GET' && (path === '/' || path === '/probe')) {
    res.writeHead(302, { ...PUBLIC_HEADERS, Location: '/probe/', 'Content-Length': 0 });
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { status: 'ok', push: vapid !== null });
  }
  if (path.startsWith('/probe/api/')) return handleApi(req, res, url);
  if (req.method === 'GET' && path.startsWith('/probe/')) {
    const file = staticFiles.get(path.slice('/probe/'.length) || 'index.html');
    if (file !== undefined) return send(res, 200, file.body, file.type);
  }
  return send(res, 404, 'Не найдено', 'text/plain; charset=utf-8');
}

// --- Служебная страница результатов ----------------------------------------

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: DISPLAY_TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const seconds = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

function transferCell(value: unknown): string {
  const item = asRecord(value);
  const ms = num(item.ms);
  if (item.ok === true && ms !== null) {
    return ms < 1000 ? `${ms} мс` : `${seconds.format(ms / 1000)} с`;
  }
  const received = num(item.received);
  const stopped = received === null ? '' : `, ${seconds.format(received / 1024)} КБ`;
  return `✗ ${escapeHtml(String(item.error ?? 'ошибка'))}${stopped}`;
}

function renderResults(): string {
  const events = store.events();
  const results = events.filter(
    (e): e is Extract<ProbeEvent, { type: 'result' }> => e.type === 'result',
  );
  const sent = events.filter(
    (e): e is Extract<ProbeEvent, { type: 'push-sent' }> => e.type === 'push-sent',
  );
  const acks = new Map(
    events
      .filter((e): e is Extract<ProbeEvent, { type: 'push-ack' }> => e.type === 'push-ack')
      .map((e) => [e.pushId, e]),
  );

  const resultRows = results
    .toReversed()
    .map(({ at, data }) => {
      const downloads = Array.isArray(data.downloads) ? data.downloads : [];
      const ping = asRecord(data.ping);
      const connection = asRecord(data.connection);
      const network = parseNetwork(data.network);
      return `<tr><td>${timeFormat.format(new Date(at))}</td><td>${escapeHtml(String(data.label))}</td>
<td>${network === null ? '?' : NETWORK_LABELS[network]}</td><td>${escapeHtml(String(connection.type ?? ''))}</td>
<td>${escapeHtml(String(data.host ?? ''))}</td><td>${num(ping.median) ?? '—'}</td>
${downloads.map((d) => `<td>${transferCell(d)}</td>`).join('')}<td>${transferCell(data.upload)}</td></tr>`;
    })
    .join('\n');

  const pushRows = sent
    .toReversed()
    .map((push) => {
      const ack = acks.get(push.pushId);
      const phone = ack?.phoneLatencyMs ?? null;
      const server = ack?.serverLatencyMs ?? null;
      return `<tr><td>${timeFormat.format(new Date(push.at))}</td><td>${escapeHtml(push.label)}</td>
<td>${push.delaySec} с</td><td>${push.status ?? '—'}${push.error ? ` ${escapeHtml(push.error)}` : ''}</td>
<td>${phone === null ? '—' : `${seconds.format(phone / 1000)} с`}</td>
<td>${server === null ? 'нет' : `${seconds.format(server / 1000)} с`}</td></tr>`;
    })
    .join('\n');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Результаты замеров</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#1f2a24}table{border-collapse:collapse;margin-bottom:32px}
td,th{border:1px solid #c9cfc7;padding:4px 8px;text-align:left;vertical-align:top}th{background:#eef1ea}</style></head>
<body><h1>Замеры этапа 0</h1><p>Часовой пояс: ${escapeHtml(DISPLAY_TZ)}. Push: ${vapid === null ? 'ключи не настроены' : 'настроен'}.</p>
<h2>Скорость</h2><table><tr><th>Время</th><th>Телефон</th><th>Сеть</th><th>Тип связи</th><th>Вход</th>
<th>Пинг, мс</th><th>16 КБ</th><th>256 КБ</th><th>1 МБ</th><th>5 МБ</th><th>Отправка 1 МБ</th></tr>
${resultRows}</table>
<h2>Push</h2><table><tr><th>Отправлен</th><th>Телефон</th><th>Задержка</th><th>Ответ службы push</th>
<th>Дошёл за (по часам телефона)</th><th>Подтверждение дошло до сервера</th></tr>
${pushRows}</table></body></html>`;
}

function handleAdmin(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? '/', 'http://admin.invalid').pathname;
  if (req.method !== 'GET') {
    send(res, 405, '', 'text/plain', ADMIN_HEADERS);
  } else if (path === '/') {
    send(res, 200, renderResults(), 'text/html; charset=utf-8', ADMIN_HEADERS);
  } else if (path === '/results.json') {
    // Ключи подписок push не выгружаются.
    const events = store
      .events()
      .map((e) => (e.type === 'subscription' ? { ...e, subscription: null } : e));
    const body = JSON.stringify(events, null, 2);
    send(res, 200, body, 'application/json; charset=utf-8', ADMIN_HEADERS);
  } else {
    send(res, 404, 'Не найдено', 'text/plain; charset=utf-8', ADMIN_HEADERS);
  }
}

// --- Запуск -----------------------------------------------------------------

const publicServer = createServer((req, res) => {
  handlePublic(req, res).catch((error: unknown) => {
    log('error', 'request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
  });
});
const adminServer = createServer(handleAdmin);

publicServer.listen(PORT, HOST, () => log('info', 'probe listening', { host: HOST, port: PORT }));
adminServer.listen(ADMIN_PORT, HOST, () =>
  log('info', 'results listening', { host: HOST, port: ADMIN_PORT, push: vapid !== null }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    for (const timer of pushTimers) clearTimeout(timer);
    publicServer.close();
    adminServer.close();
    process.exit(0);
  });
}
