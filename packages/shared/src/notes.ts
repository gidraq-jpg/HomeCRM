import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
export const NoteChecklist = z
  .array(
    z.strictObject({
      id: z.uuid().optional(),
      clientId: z.uuid().optional(),
      title,
      done: z.boolean().default(false),
    }),
  )
  .max(200)
  .refine((items) => {
    const ids = items.flatMap((item) => (item.id ? [item.id] : []));
    const clients = items.flatMap((item) => (item.clientId ? [item.clientId] : []));
    return new Set(ids).size === ids.length && new Set(clients).size === clients.length;
  });
export const NoteCreate = z.strictObject({
  title,
  body: z.string().max(100000).default(''),
  pinned: z.boolean().default(false),
  checklist: NoteChecklist.default([]),
  placement: z
    .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
    .optional(),
  object: z.strictObject({ type: z.enum(['object', 'task']), id: z.uuid() }).optional(),
  idempotencyKey: z.uuid().optional(),
  ownerAccountId: z.uuid().optional(),
  offline: z.literal(true).optional(),
  clientActedAt: z.iso.datetime().optional(),
});
export const NotePatchFields = z.strictObject({
  title: title.optional(),
  body: z.string().max(100000).optional(),
  pinned: z.boolean().optional(),
  assigneeId: z.uuid().optional(),
  checklist: NoteChecklist.optional(),
  expectedUpdatedAt: z.iso.datetime().optional(),
  idempotencyKey: z.uuid().optional(),
  ownerAccountId: z.uuid().optional(),
  offline: z.literal(true).optional(),
  clientActedAt: z.iso.datetime().optional(),
});
export const NotePatch = NotePatchFields.refine((value) =>
  ['title', 'body', 'pinned', 'assigneeId', 'checklist'].some((key) => key in value),
);
