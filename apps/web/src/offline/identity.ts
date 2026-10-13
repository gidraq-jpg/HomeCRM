import type { Me } from '../auth/api.ts';
import { type Identity, offlineDB } from './store.ts';

export class LocalFailure extends Error {
  readonly code: string;
  readonly intentId?: string;
  constructor(code: string, intentId?: string) {
    super(code);
    this.code = code;
    this.intentId = intentId;
  }
}
export class LocalSaved extends LocalFailure {
  constructor(id: string) {
    super('LOCAL_SAVED', id);
  }
}
let viewOwner: string | null = null;
export const offlineEvents = new EventTarget();
export function accountChanged() {
  viewOwner = null;
  changed('identity');
}
export async function offlineOwnerAvailable() {
  try {
    return !!(await offlineDB.identity.get('active'))?.owner;
  } catch (_error) {
    changed('storage-error');
    if (typeof navigator !== 'undefined' && !navigator.onLine)
      throw new LocalFailure('LOCAL_STORAGE');
    return false;
  }
}
export async function requestTicket() {
  const active = await ticket();
  if (!viewOwner || active.owner !== viewOwner) throw new LocalFailure('ACCOUNT_CHANGED');
  return active;
}
const channel =
  typeof BroadcastChannel === 'undefined' || typeof indexedDB === 'undefined'
    ? null
    : new BroadcastChannel('homecrm-offline');
export function changed(type = 'queue', source?: symbol) {
  offlineEvents.dispatchEvent(Object.assign(new Event(type), { source }));
  channel?.postMessage(type);
}
channel?.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    if (event.data === 'identity') viewOwner = null;
    offlineEvents.dispatchEvent(new Event(event.data));
  }
});
export async function ticket(): Promise<Identity> {
  return (
    (await offlineDB.identity.get('active')) ?? {
      id: 'active',
      owner: null,
      generation: 0,
      me: null,
      verified: false,
    }
  );
}
export async function assertIdentity(expected: Pick<Identity, 'owner' | 'generation'>) {
  const active = await ticket();
  if (
    !expected.owner ||
    active.owner !== expected.owner ||
    active.generation !== expected.generation
  )
    throw new LocalFailure('ACCOUNT_CHANGED');
  return active;
}
export async function setIdentity(me: Me | null, expected?: Identity, source?: symbol) {
  let announce = false;
  await offlineDB.transaction('rw', offlineDB.tables, async () => {
    const active = await ticket();
    if (expected && (expected.generation !== active.generation || expected.owner !== active.owner))
      throw new LocalFailure('ACCOUNT_CHANGED');
    const accountChanged = active.owner !== (me?.id ?? null);
    const roles = (value: Me | null) =>
      JSON.stringify(
        value?.roles.toSorted((a, b) => a.householdId.localeCompare(b.householdId)) ?? [],
      );
    const permissionsChanged =
      !accountChanged &&
      !!me &&
      (roles(active.me) !== roles(me) || active.me?.personalSpaceId !== me.personalSpaceId);
    announce = accountChanged || permissionsChanged;
    if (permissionsChanged) await offlineDB.snapshots.clear();
    if (accountChanged) {
      for (const table of [
        offlineDB.snapshots,
        offlineDB.outbox,
        offlineDB.blobs,
        offlineDB.drafts,
        offlineDB.leases,
      ])
        await table.clear();
    }
    // Кэшированная идентичность только маркирует локальные данные, не разрешает отправку.
    const cached = me ? { ...me, email: null, username: null, passwordReset: null } : null;
    await offlineDB.identity.put({
      id: 'active',
      owner: me?.id ?? null,
      generation: active.generation + (announce ? 1 : 0),
      me: cached,
      verified: !!me,
      locked: false,
    });
  });
  viewOwner = me?.id ?? null;
  if (announce) changed('identity', source);
}
export async function blockIdentity(source?: symbol) {
  const active = await ticket();
  if (active.locked && !active.verified) return;
  await offlineDB.identity.update('active', { verified: false, locked: true });
  changed('identity', source);
}
export async function cachedIdentity(): Promise<Me | null> {
  const active = await ticket();
  if (!active.owner || !active.me || active.locked || active.me.secondFactorRequired) return null;
  await offlineDB.identity.update('active', { verified: false });
  viewOwner = active.owner;
  return active.me;
}
export function localMessage(error: unknown): string | null {
  if (!(error instanceof LocalFailure)) return null;
  const messages: Record<string, string> = {
    LOCAL_SAVED: 'Сохранено на устройстве. Сервер ещё не подтвердил. Откройте «Очередь изменений».',
    ACCOUNT_CHANGED: 'Учётная запись изменилась. Обновите вход перед продолжением.',
    NETWORK_REQUIRED: 'Для этого действия нужно подключение к сети.',
    SNAPSHOT_MISSING: 'Эти данные ещё не сохранены на устройстве. Откройте их с сетью.',
    EXACT_VERSION_REQUIRED:
      'Нет согласованного снимка для правки. Сначала откройте запись с сетью.',
    LOCAL_QUOTA: 'На устройстве недостаточно места. Данные не сохранены: оставьте форму открытой.',
    LOCAL_STORAGE: 'Не удалось сохранить на устройстве. Данные остались в форме.',
    ALREADY_SENT:
      'Исход отправки ещё неизвестен. Сначала получите подтверждение исходного запроса.',
    DEPENDENT: 'Сначала отмените зависимые изменения.',
    LEASE_BUSY: 'Очередь уже отправляется в другой вкладке.',
  };
  return messages[error.code] ?? 'Локальные данные не подтверждены. Откройте очередь изменений.';
}
