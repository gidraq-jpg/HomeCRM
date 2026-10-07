import {
  NotificationSettings,
  type NotificationSettingsPatch,
  type PushSubscriptionInput,
} from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

export type SettingsPatch = z.infer<typeof NotificationSettingsPatch>;
type SubscriptionBody = z.infer<typeof PushSubscriptionInput>;

// Уведомления: ADR-0029, apps/server/src/notifications. Адреса и ключи устройств сервер не возвращает,
// а в журнале нет ни названий записей, ни их текстов — их нет и на экране.

export const PushDevice = z.object({
  id: z.string(),
  deviceName: z.string(),
  createdAt: z.string(),
  lastSuccessAt: z.string().nullable(),
});
export type PushDevice = z.infer<typeof PushDevice>;

/** Попытка отправки: когда, какого вида, на какое устройство и чем закончилась. */
export const Delivery = z.object({
  id: z.string(),
  deviceId: z.string(),
  kind: z.string(),
  attemptedAt: z.string(),
  result: z.string(),
  errorCode: z.number().nullable(),
});
export type Delivery = z.infer<typeof Delivery>;

export function fetchPushKey() {
  return apiRequest('GET', 'push/key', z.object({ publicKey: z.string() }));
}

export function fetchDevices(signal?: AbortSignal) {
  return apiRequest('GET', 'push/subscriptions', z.array(PushDevice), undefined, signal);
}

export function createSubscription(input: SubscriptionBody) {
  return apiRequest(
    'POST',
    'push/subscriptions',
    z.object({ id: z.string(), deviceName: z.string() }),
    input,
  );
}

export function removeDevice(id: string) {
  return apiRequest('DELETE', `push/subscriptions/${id}`, z.null());
}

export function fetchSettings(signal?: AbortSignal) {
  return apiRequest('GET', 'notifications/settings', NotificationSettings, undefined, signal);
}

export function saveSettings(patch: SettingsPatch) {
  return apiRequest('PATCH', 'notifications/settings', NotificationSettings, patch);
}

export function fetchDeliveries(signal?: AbortSignal) {
  return apiRequest('GET', 'notifications/deliveries', z.array(Delivery), undefined, signal);
}
