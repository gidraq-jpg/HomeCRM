import { PushSubscriptionInput } from '@homecrm/shared';
import { useMemo, useSyncExternalStore } from 'react';
import { ApiError } from '../auth/api.ts';
import { deviceName } from '../pwa/device-name.ts';
import { keyToBytes, sameKey } from '../pwa/push-key.ts';
import { createSubscription, fetchDevices, fetchPushKey, removeDevice } from './api.ts';

// Подписка этого браузера на push (NOTIF-1, ADR-0009, ADR-0029). Страница хранит в localStorage
// только то, что нужно для удобства: когда человек отказался от карточки и какое устройство (его UUID)
// включено у этого участника. Адреса и ключи подписки в хранилища страницы не попадают.

export type PushErrorCode =
  | 'unsupported'
  | 'denied'
  | 'dismissed'
  | 'not-configured'
  | 'no-worker'
  | 'subscribe-failed';

export class PushError extends Error {
  readonly code: PushErrorCode;
  constructor(code: PushErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Отказ от карточки помнится по участнику: на общем компьютере у второго человека карточка своя. */
export const dismissedKey = (account: string) => `homecrm.push.card-dismissed.${account}`;
const DEVICE_KEY = 'homecrm.push.device';
const WORKER_WAIT_MS = 8000;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Хранилище закрыто (приватное окно, запрет сайта): работаем без запоминания.
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // См. выше: без хранилища отказ от карточки и признак устройства живут до перезагрузки.
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type Permission = 'default' | 'granted' | 'denied';

export interface PushState {
  supported: boolean;
  permission: Permission;
  /** Устройство этого браузера у этого участника, если он его включал здесь. */
  deviceId: string | null;
  dismissed: boolean;
}

// Память — запасной вариант, когда localStorage закрыт: отказ и устройство живут до перезагрузки.
const memory: { dismissed: Set<string>; devices: Map<string, string> } = {
  dismissed: new Set(),
  devices: new Map(),
};
let version = 0;
const listeners = new Set<() => void>();

function storedDevice(account: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readStorage(DEVICE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && 'a' in parsed && 'id' in parsed) {
      if (parsed.a === account && typeof parsed.id === 'string') return parsed.id;
    }
  } catch {
    // Повреждённая запись равна отсутствию записи.
  }
  return memory.devices.get(account) ?? null;
}

function rememberDevice(account: string, id: string | null): void {
  if (id) memory.devices.set(account, id);
  else memory.devices.delete(account);
  // В хранилище лежит одно устройство: браузер подписан на push одной подпиской, у одного участника.
  writeStorage(DEVICE_KEY, id ? JSON.stringify({ a: account, id }) : null);
}

export function cardDismissed(account: string): boolean {
  return memory.dismissed.has(account) || readStorage(dismissedKey(account)) === '1';
}

function readState(account: string): PushState {
  const supported = pushSupported();
  return {
    supported,
    // Без поддержки разрешения нет вообще: supported важнее, чем permission.
    permission: supported ? Notification.permission : 'default',
    deviceId: storedDevice(account),
    dismissed: cardDismissed(account),
  };
}

/** Сообщить экранам, что состояние браузера могло измениться (разрешение, устройство, отказ от карточки). */
export function refreshPushState(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Разрешение меняют в настройках браузера, пока страница в фоне: перечитываем при возврате.
  window.addEventListener('focus', refreshPushState);
  document.addEventListener('visibilitychange', refreshPushState);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('focus', refreshPushState);
    document.removeEventListener('visibilitychange', refreshPushState);
  };
}

/** Состояние push этого браузера для участника `accountId`. */
export function usePushState(accountId: string): PushState {
  const stamp = useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` — сигнал «перечитать браузер».
  return useMemo(() => readState(accountId), [accountId, stamp]);
}
export function dismissPushCard(account: string): void {
  memory.dismissed.add(account);
  writeStorage(dismissedKey(account), '1');
  refreshPushState();
}

async function readyWorker(): Promise<ServiceWorkerRegistration> {
  const wait = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new PushError('no-worker')), WORKER_WAIT_MS);
  });
  return Promise.race([navigator.serviceWorker.ready, wait]);
}

async function browserSubscription(
  registration: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
  fresh: boolean,
): Promise<PushSubscription> {
  let subscription = await registration.pushManager.getSubscription();
  // Подписка с другим ключом сервера (ключ заменили) не заработает: делаем новую.
  if (subscription && (fresh || !sameKey(subscription.options.applicationServerKey, key))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (subscription) return subscription;
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError')
      throw new PushError('denied');
    throw new PushError('subscribe-failed');
  }
}

async function register(
  registration: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
  fresh = false,
): Promise<string> {
  const subscription = await browserSubscription(registration, key, fresh);
  const { endpoint, keys } = subscription.toJSON();
  const body = PushSubscriptionInput.safeParse({
    endpoint,
    keys,
    deviceName: deviceName(navigator.userAgent),
  });
  // Службы вне списка сервера (ADR-0029) он не примет: сообщаем об этом сразу, а не ошибкой запроса.
  if (!body.success) throw new PushError('subscribe-failed');
  try {
    return (await createSubscription(body.data)).id;
  } catch (error) {
    // Адрес уже занят старой записью: подписку браузера обновляем и повторяем один раз.
    if (error instanceof ApiError && error.status === 409 && !fresh)
      return register(registration, key, true);
    throw error;
  }
}

async function serverKey(): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return keyToBytes((await fetchPushKey()).publicKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw new PushError('not-configured');
    throw error;
  }
}

/** «Включить на этом устройстве»: разрешение, подписка браузера, запись на сервере. */
export async function enablePush(accountId: string): Promise<void> {
  if (!pushSupported()) throw new PushError('unsupported');
  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  refreshPushState();
  if (permission === 'denied') throw new PushError('denied');
  if (permission !== 'granted') throw new PushError('dismissed');
  const key = await serverKey();
  const registration = await readyWorker();
  const id = await register(registration, key);
  rememberDevice(accountId, id);
  refreshPushState();
}

/** Отключить это устройство: запись на сервере и подписка браузера. */
export async function disablePush(accountId: string, id: string): Promise<void> {
  await removeThisDevice(id);
  rememberDevice(accountId, null);
  if (pushSupported()) {
    const registration = await readyWorker();
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
  refreshPushState();
}

async function removeThisDevice(id: string): Promise<void> {
  try {
    await removeDevice(id);
  } catch (error) {
    // Сервер уже не знает устройство (его отключили в другом месте): цель достигнута.
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

/** Устройство, отключённое из списка, забывается и в браузере, если это то самое устройство. */
export async function forgetIfThisDevice(accountId: string, id: string): Promise<boolean> {
  if (storedDevice(accountId) !== id) return false;
  await disablePush(accountId, id).catch(() => {
    // Запись на сервере уже удалена; подписку браузера уберёт сервис-воркер при ближайшем ответе 410.
  });
  return true;
}

/**
 * Вход создаёт новую сессию, а подписка привязана к сессии (ADR-0029): если участник включал уведомления на
 * этом устройстве, при запуске приложения привязываем подписку браузера к новой сессии. Без разрешения и без
 * прежнего включения ничего не делаем: молча подписывать участника нельзя.
 */
export async function resyncPush(accountId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const remembered = storedDevice(accountId);
  if (!remembered) return;
  const known = await fetchDevices();
  if (known.some((device) => device.id === remembered)) return;
  const key = await serverKey();
  const registration = await readyWorker();
  if (!(await registration.pushManager.getSubscription())) {
    rememberDevice(accountId, null);
    refreshPushState();
    return;
  }
  rememberDevice(accountId, await register(registration, key));
  refreshPushState();
}
