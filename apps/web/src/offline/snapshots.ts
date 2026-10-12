import { OfflineSnapshot } from '@homecrm/shared';
import type { z } from 'zod';
import {
  accountChanged,
  assertIdentity,
  blockIdentity,
  changed,
  LocalFailure,
  requestTicket,
} from './identity.ts';
import { type Identity, LIMITS, offlineDB } from './store.ts';

const timing = new WeakMap<
  object,
  { serverDate: string | null; elapsed: number; receivedAt: number }
>();
export function snapshotTiming(value: unknown) {
  return value && typeof value === 'object' ? timing.get(value) : undefined;
}

// Закрытая allowlist: файлы, unmask, настройки, безопасность, поиск и экспорт сюда не входят.
const routes = [
  /^tasks(?:\/(?:today|plan|[0-9a-f-]{36}))?$/,
  /^notes(?:\/[0-9a-f-]{36})?$/,
  /^objects(?:\/[0-9a-f-]{36}(?:\/(?:meters|accounts))?)?$/,
  /^meters\/[0-9a-f-]{36}(?:\/readings)?$/,
  /^readings\/[0-9a-f-]{36}$/,
  /^deadlines$/,
  /^shopping(?:\/[0-9a-f-]{36})?$/,
  /^documents(?:\/[0-9a-f-]{36}(?:\/versions)?)?$/,
  /^contacts(?:\/[0-9a-f-]{36}(?:\/interactions)?)?$/,
  /^accounts(?:\/[0-9a-f-]{36})?$/,
];
export function snapshotPath(path: string): string | null {
  const url = new URL(path, 'https://local.invalid/');
  if (!routes.some((route) => route.test(url.pathname.slice(1)))) return null;
  url.searchParams.delete('offline');
  url.searchParams.sort();
  return url.pathname.slice(1) + (url.search ? url.search : '');
}
export async function saveSnapshot(path: string, wrapper: unknown, expected: Identity) {
  const result = OfflineSnapshot.parse(wrapper);
  if (result.accountId !== expected.owner) throw new LocalFailure('ACCOUNT_CHANGED');
  const key = `${expected.owner}:${path}`;
  const bytes = new TextEncoder().encode(JSON.stringify(result.data)).byteLength;
  if (bytes > LIMITS.snapshotBytes) return;
  await offlineDB.transaction('rw', offlineDB.identity, offlineDB.snapshots, async () => {
    await assertIdentity(expected);
    await offlineDB.snapshots.put({
      key,
      owner: result.accountId,
      path,
      capturedAt: Date.now(),
      bytes,
      data: result.data,
      versions: result.versions,
    });
    const rows = await offlineDB.snapshots.orderBy('capturedAt').toArray();
    let size = rows.reduce((sum, row) => sum + row.bytes, 0);
    let count = rows.length;
    for (const row of rows) {
      if (
        count <= LIMITS.snapshots &&
        size <= LIMITS.snapshotBytes &&
        row.capturedAt >= Date.now() - LIMITS.snapshotAge
      )
        break;
      await offlineDB.snapshots.delete(row.key);
      size -= row.bytes;
      count--;
    }
  });
  changed('snapshot');
}
export async function loadSnapshot<T>(path: string, schema: z.ZodType<T>, expected: Identity) {
  await assertIdentity(expected);
  const row = await offlineDB.snapshots.get(`${expected.owner}:${path}`);
  if (!row || row.capturedAt < Date.now() - LIMITS.snapshotAge)
    throw new LocalFailure('SNAPSHOT_MISSING');
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) throw new LocalFailure('SNAPSHOT_MISSING');
  changed('snapshot');
  return parsed.data;
}
export async function exactVersion(id: string, expected: Identity, observed?: string) {
  await assertIdentity(expected);
  const rows = await offlineDB.snapshots
    .where('owner')
    .equals(expected.owner ?? '')
    .reverse()
    .sortBy('capturedAt');
  // Версию берём только из снимка, в котором получено редактируемое содержимое.
  for (const row of rows.reverse()) {
    if (row.capturedAt < Date.now() - LIMITS.snapshotAge) continue;
    const version = row.versions.find((v) => v.id === id)?.version;
    if (!version) continue;
    const cards = flattenCards(row.data);
    const card = cards.find((value) => value.id === id);
    if (!card || (observed && card.updatedAt !== observed)) continue;
    return version;
  }
  throw new LocalFailure('EXACT_VERSION_REQUIRED');
}
function flattenCards(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(flattenCards);
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  return [
    record,
    ...Object.values(record)
      .filter((v) => typeof v === 'object')
      .flatMap(flattenCards),
  ];
}
export async function snapshotRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const normalized = snapshotPath(path);
  if (!normalized) throw new LocalFailure('NETWORK_REQUIRED');
  const expected = await requestTicket();
  if (!expected.owner) throw new LocalFailure('ACCOUNT_CHANGED');
  if (!navigator.onLine) return loadSnapshot(normalized, schema, expected);
  const url = new URL(path, `${globalThis.location.origin}/api/`);
  url.searchParams.set('offline', 'true');
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url.pathname + url.search, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return loadSnapshot(normalized, schema, expected);
  }
  if (!response.ok) {
    // 401/403/404 нельзя заменять кэшем. Отзываем локальное чтение конкретного пути.
    await offlineDB.snapshots.delete(`${expected.owner}:${normalized}`);
    if (response.status === 401 || response.status === 403) await blockIdentity();
    const body = await response.json().catch(() => null);
    throw Object.assign(new Error('HTTP_ERROR'), {
      status: response.status,
      code: body?.code ?? '',
    });
  }
  const wrapper = OfflineSnapshot.safeParse(await response.json());
  if (!wrapper.success) throw new LocalFailure('SNAPSHOT_MISSING');
  await assertIdentity(expected);
  if (wrapper.data.accountId !== expected.owner) {
    accountChanged();
    throw new LocalFailure('ACCOUNT_CHANGED');
  }
  const versionMap = new Map(wrapper.data.versions.map((item) => [item.id, item.version]));
  const withVersions = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withVersions);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const result = Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, withVersions(item)]),
    );
    if (
      typeof record.id === 'string' &&
      typeof record.updatedAt === 'string' &&
      versionMap.has(record.id)
    )
      result.updatedAt = versionMap.get(record.id);
    return result;
  };
  // updatedAt карточки берётся из ТОГО ЖЕ snapshot, с полной точностью сервера.
  const parsed = schema.safeParse(withVersions(wrapper.data.data));
  if (!parsed.success) throw new LocalFailure('SNAPSHOT_MISSING');
  // Неудача кэша не отменяет успешное сетевое чтение, но видна панели офлайн.
  try {
    await saveSnapshot(normalized, { ...wrapper.data, data: parsed.data }, expected);
  } catch (error) {
    if (error instanceof LocalFailure) throw error;
    changed('storage-error');
  }
  await assertIdentity(expected);
  if (parsed.data && typeof parsed.data === 'object')
    timing.set(parsed.data, {
      serverDate: response.headers.get('date'),
      elapsed: performance.now() - started,
      receivedAt: performance.now(),
    });
  return parsed.data;
}
