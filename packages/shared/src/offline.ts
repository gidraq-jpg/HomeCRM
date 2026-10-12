import { z } from 'zod';
import { ReadingInput } from './meters.ts';
import { NoteCreate, NotePatchFields } from './notes.ts';
import { TaskFields, TaskStatus } from './tasks.ts';

export const OfflineMetadata = z.strictObject({
  ownerAccountId: z.uuid(),
  offline: z.literal(true),
  idempotencyKey: z.uuid(),
  clientActedAt: z.iso.datetime().optional(),
});
export const OfflineTaskCreate = TaskFields.extend({
  ...OfflineMetadata.shape,
  placement: z
    .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
    .optional(),
  householdId: z.uuid().optional(),
  objectId: z.uuid().optional(),
  links: z
    .array(
      z.strictObject({
        type: z.enum(['object', 'contact', 'document', 'utility_charge']),
        id: z.uuid(),
        role: z.string().trim().max(200).default(''),
      }),
    )
    .max(100)
    .default([]),
});
export const OfflineTaskPatch = z
  .strictObject({
    title: TaskFields.shape.title.optional(),
    description: TaskFields.shape.description.unwrap().optional(),
    planOn: TaskFields.shape.planOn.unwrap().optional(),
    planTime: TaskFields.shape.planTime.unwrap().optional(),
    dueOn: TaskFields.shape.dueOn.unwrap().optional(),
    dueTime: TaskFields.shape.dueTime.unwrap().optional(),
    checklist: TaskFields.shape.checklist.unwrap().optional(),
  })
  .extend({
    ...OfflineMetadata.shape,
    expectedUpdatedAt: z.iso.datetime(),
  })
  .refine((body) =>
    ['title', 'description', 'planOn', 'planTime', 'dueOn', 'dueTime', 'checklist'].some(
      (key) => key in body,
    ),
  );
export const OfflineTaskStatus = z.strictObject({
  ...OfflineMetadata.shape,
  status: TaskStatus.extract(['done']),
  expectedUpdatedAt: z.iso.datetime(),
});
export const OfflineNoteCreate = NoteCreate.extend(OfflineMetadata.shape);
export const OfflineNotePatch = NotePatchFields.omit({ assigneeId: true }).extend({
  ...OfflineMetadata.shape,
  expectedUpdatedAt: z.iso.datetime(),
});
export const ReadingCreate = ReadingInput.extend({
  ownerAccountId: z.uuid().optional(),
  expectedUpdatedAt: z.iso.datetime().optional(),
  expectedLatestReadingId: z.uuid().nullable().optional(),
  idempotencyKey: z.uuid().optional(),
  offline: z.literal(true).optional(),
  clientActedAt: z.iso.datetime().optional(),
});
export const OfflineReadingCreate = ReadingCreate.extend({
  ...OfflineMetadata.shape,
  expectedUpdatedAt: z.iso.datetime(),
  expectedLatestReadingId: z.uuid().nullable(),
});
const ReadingsCreateFields = z.strictObject({
  readings: z
    .array(
      ReadingCreate.omit({
        idempotencyKey: true,
        offline: true,
        clientActedAt: true,
        ownerAccountId: true,
      }).extend({
        meterId: z.uuid(),
      }),
    )
    .min(1)
    .max(100),
  idempotencyKey: z.uuid().optional(),
  ownerAccountId: z.uuid().optional(),
  offline: z.literal(true).optional(),
  clientActedAt: z.iso.datetime().optional(),
});
export const ReadingsCreate = ReadingsCreateFields.refine(
  (body) => new Set(body.readings.map((reading) => reading.meterId)).size === body.readings.length,
);
export const OfflineReadingsCreate = ReadingsCreateFields.extend({
  ...OfflineMetadata.shape,
  readings: z
    .array(
      OfflineReadingCreate.omit({
        ownerAccountId: true,
        idempotencyKey: true,
        offline: true,
        clientActedAt: true,
      }).extend({ meterId: z.uuid() }),
    )
    .min(1)
    .max(100),
}).refine(
  (body) => new Set(body.readings.map((reading) => reading.meterId)).size === body.readings.length,
);
/** Только служебные UUID и моменты; содержимое источников сюда не попадает. */
export const OperationReceipt = z.strictObject({
  ownerAccountId: z.uuid(),
  key: z.uuid(),
  operation: z.string().min(1).max(100),
  confirmedAt: z.iso.datetime(),
  results: z
    .array(z.strictObject({ id: z.uuid(), updatedAt: z.iso.datetime() }))
    .min(1)
    .max(200),
  checklist: z
    .array(
      z.strictObject({
        id: z.uuid(),
        clientId: z.uuid().optional(),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(200)
    .optional(),
  completionEventId: z.uuid().nullable().optional(),
  nextTaskId: z.uuid().nullable().optional(),
  warningIds: z.array(z.uuid()).max(100).optional(),
});
export type OperationReceipt = z.infer<typeof OperationReceipt>;
export const OfflineSnapshot = z.strictObject({
  accountId: z.uuid(),
  data: z.unknown(),
  versions: z.array(z.strictObject({ id: z.uuid(), version: z.iso.datetime() })),
});
export const OFFLINE_OPERATIONS = [
  { method: 'POST', route: '/api/tasks', operation: 'task_create' },
  { method: 'PATCH', route: '/api/tasks/:id', operation: 'task_patch' },
  { method: 'POST', route: '/api/tasks/:id/status', operation: 'task_status' },
  { method: 'POST', route: '/api/notes', operation: 'note_create' },
  { method: 'PATCH', route: '/api/notes/:id', operation: 'note_patch' },
  { method: 'POST', route: '/api/objects/:id/files', operation: 'file_upload' },
  { method: 'POST', route: '/api/meters/:id/readings', operation: 'reading_create' },
  { method: 'POST', route: '/api/objects/:id/readings', operation: 'readings_create' },
] as const;
