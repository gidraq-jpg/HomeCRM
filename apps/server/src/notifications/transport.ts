import { createHash } from 'node:crypto';
import { PushEndpoint } from '@homecrm/shared';
import webpush from 'web-push';
import { z } from 'zod';

export const VapidConfig = z.object({
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  VAPID_SUBJECT: z
    .string()
    .refine(
      (s) =>
        /^mailto:[^\s@]+@[^\s@]+$/.test(s) || (URL.canParse(s) && new URL(s).protocol === 'https:'),
    ),
});
export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushSender = (
  device: PushDevice,
  payload: { kind: 'deadline'; recordId: string; text: string; notificationKind?: string },
  deliveryId: string,
) => Promise<void>;
export function createPushSender(config: z.infer<typeof VapidConfig>): PushSender {
  return async (device, payload, deliveryId) => {
    PushEndpoint.parse(device.endpoint);
    await webpush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          publicKey: config.VAPID_PUBLIC_KEY,
          privateKey: config.VAPID_PRIVATE_KEY,
          subject: config.VAPID_SUBJECT,
        },
        TTL: 300,
        timeout: 10_000,
        topic: createHash('sha256').update(deliveryId).digest('base64url').slice(0, 32),
      },
    );
  };
}
/** Ни body ответа, ни endpoint, ни текст исключения не выходят из транспортной границы. */
export function pushErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null;
  const code = error.statusCode;
  return typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599
    ? code
    : null;
}
