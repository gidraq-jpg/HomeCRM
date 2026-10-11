import { z } from 'zod';
import { CalendarDate, DeadlineRule, RADAR_GROUPS, TimeZone } from './deadlines.ts';

const CalendarTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// Проверка пояса одинакова для всех участников: кэш только валидности публичного IANA-ID,
// без данных источников. Ограничение не даёт строкам запроса накапливаться в памяти.
const validZones = new Set<string>();
const ResponseTimeZone = z.string().refine((value) => {
  if (validZones.has(value)) return true;
  if (!TimeZone.safeParse(value).success) return false;
  if (validZones.size >= 64) validZones.clear();
  validZones.add(value);
  return true;
}, 'Expected an IANA time zone');

export const RadarFilters = z
  .strictObject({
    from: CalendarDate,
    to: CalendarDate,
    householdId: z.uuid().optional(),
    objectId: z.uuid().optional(),
    personId: z.uuid().optional(),
    scope: z.enum(['all', 'personal', 'household']).default('all'),
    view: z.enum(['all', 'mine']).default('all'),
    state: z.enum(['active', 'snoozed', 'dismissed', 'all']).default('active'),
  })
  .refine((x) => x.from <= x.to);
export type RadarFilters = z.infer<typeof RadarFilters>;

export const RadarActionInput = z
  .strictObject({
    action: z.enum(['snooze', 'dismiss', 'restore', 'complete']),
    date: CalendarDate.optional(),
    time: CalendarTime.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    expectedVersion: z.number().int().nonnegative(),
    calendarKey: z.string().regex(/^[a-f0-9]{32}$/),
    idempotencyKey: z.uuid(),
  })
  .superRefine((x, ctx) => {
    if (x.action === 'snooze' && (!x.date || !x.time))
      ctx.addIssue({ code: 'custom', message: 'Укажите дату и время' });
    if (x.action === 'dismiss' && !x.reason)
      ctx.addIssue({ code: 'custom', message: 'Укажите причину' });
  });
export const RadarActionState = z.strictObject({
  version: z.number().int().nonnegative(),
  status: z.enum(['active', 'snoozed', 'dismissed', 'completed']),
  snoozedUntil: z.iso.datetime().nullable(),
  reason: z.string().nullable(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable().optional(),
  changedAt: z.iso.datetime().nullable(),
});
export const RadarFilterOption = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  role: z.string(),
});
export type RadarActionInput = z.infer<typeof RadarActionInput>;
export const SummaryKind = z.enum(['morning', 'weekly']);
export const SummaryMetadata = z.strictObject({
  id: z.uuid(),
  accountId: z.uuid(),
  householdId: z.uuid(),
  householdName: z.string().optional(),
  timeZone: ResponseTimeZone,
  kind: SummaryKind,
  localDate: CalendarDate,
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const RadarPrimaryAction = z.strictObject({
  kind: z.enum(['enter_readings', 'mark_payment', 'verify_meter', 'renew_document']),
  label: z.string(),
  objectId: z.uuid().nullable().optional(),
  occurrenceId: z.uuid().optional(),
  meterId: z.uuid().optional(),
  documentId: z.uuid().nullable().optional(),
  hint: z.string().optional(),
  completionAction: z
    .strictObject({ kind: z.literal('mark_readings'), label: z.string(), occurrenceId: z.uuid() })
    .optional(),
});
/** Полный ответ агрегата: названия получены только из текущего RLS источников. */
export const RadarResponseItem = z.strictObject({
  id: z.uuid(),
  deadlineId: z.uuid(),
  calendarKey: z.string().regex(/^[a-f0-9]{32}$/),
  date: CalendarDate,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: ResponseTimeZone,
  warningsAt: z.array(z.iso.datetime()),
  completedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  spaceId: z.uuid(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(['household', 'adults']).nullable(),
  authorId: z.uuid(),
  assigneeId: z.uuid(),
  householdId: z.uuid(),
  noteId: z.uuid().nullable(),
  objectId: z.uuid().nullable(),
  documentId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  profileAccountId: z.uuid().nullable(),
  birthday: z.string().nullable(),
  title: z.string(),
  rule: DeadlineRule,
  sourceKind: z.enum([
    'record',
    'readings',
    'payment',
    'verification',
    'document',
    'birthday',
    'task_plan',
    'task_due',
    'task_waiting',
  ]),
  canWrite: z.boolean(),
  missingReadingsCount: z.number().int().nonnegative(),
  actionState: RadarActionState,
  objects: z.array(RadarFilterOption),
  people: z.array(RadarFilterOption),
  object: z
    .strictObject({ id: z.uuid(), title: z.string(), status: z.string().nullable() })
    .nullable(),
  utilityAccount: z
    .strictObject({
      id: z.uuid(),
      title: z.string(),
      number: z.string().nullable(),
      transmission: z.unknown(),
    })
    .nullable(),
  meter: z.strictObject({ id: z.uuid(), title: z.string() }).nullable(),
  needsMeters: z.boolean(),
  chargeId: z.uuid().nullable(),
  totalCents: z.number().int().nullable(),
  paidCents: z.number().int().nullable(),
  remainingCents: z.number().int().nullable(),
  age: z.number().int().nullable(),
  group: z.enum(RADAR_GROUPS),
  primaryAction: RadarPrimaryAction.nullable(),
});
export const RadarResponse = z.strictObject({
  items: z.array(RadarResponseItem),
  visibleCount: z.number().int().nonnegative(),
  matchingCount: z.number().int().nonnegative(),
  options: z.strictObject({
    objects: z.array(RadarFilterOption),
    people: z.array(RadarFilterOption),
    houses: z.array(RadarFilterOption),
  }),
  recalculating: z.boolean(),
  groups: z.record(z.enum(RADAR_GROUPS), z.number().int().nonnegative()),
});
export const SummaryResponse = z.strictObject({
  metadata: SummaryMetadata,
  done: z.array(
    z.strictObject({
      id: z.uuid(),
      title: z.string(),
      type: z.enum(['task', 'payment', 'document', 'deadline']),
      at: z.iso.datetime(),
      href: z.string().regex(/^\/(today\/tasks|documents|home|more\/notes|people)\//),
    }),
  ),
  today: z.array(RadarResponseItem),
  upcoming: z.array(RadarResponseItem),
  stuck: z.array(RadarResponseItem),
  deferred: z.array(
    z.strictObject({ id: z.uuid(), recordId: z.uuid().nullable(), type: z.string() }),
  ),
  recalculating: z.boolean(),
});
