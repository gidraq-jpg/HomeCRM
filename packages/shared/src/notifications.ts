import { z } from 'zod';

/** R0.7 принимает предупреждения общего движка сроков; остальные источники появятся позже. */
export const NOTIFICATION_KINDS = [
  'deadline',
  'readings_open',
  'readings_closing',
  'readings_last_day',
  'payment_upcoming',
  'payment_due',
  'verification',
] as const;
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const NotificationSettings = z.strictObject({
  quietStart: Clock.default('22:00'),
  quietEnd: Clock.default('08:00'),
  dailyBudget: z.number().int().min(0).max(100).default(5),
  enabledKinds: z
    .array(z.enum(NOTIFICATION_KINDS))
    .max(NOTIFICATION_KINDS.length)
    .default([...NOTIFICATION_KINDS]),
  hideText: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;
/** У PATCH нет defaults: пропущенные поля должны сохранять прежние значения. */
export const NotificationSettingsPatch = z.strictObject({
  quietStart: NotificationSettings.shape.quietStart.removeDefault().optional(),
  quietEnd: NotificationSettings.shape.quietEnd.removeDefault().optional(),
  dailyBudget: NotificationSettings.shape.dailyBudget.removeDefault().optional(),
  enabledKinds: NotificationSettings.shape.enabledKinds.removeDefault().optional(),
  hideText: NotificationSettings.shape.hideText.removeDefault().optional(),
});

/** Адрес задаёт браузер, но запрос worker не должен уходить во внутреннюю сеть. */
export const PushEndpoint = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^\s#]+$/,
  );
export const PushSubscriptionInput = z.strictObject({
  endpoint: PushEndpoint,
  keys: z.strictObject({
    p256dh: z.string().regex(/^B[A-P][A-Za-z0-9_-]{85}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  deviceName: z.string().trim().min(1).max(100),
});
