import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const body = z.string().max(100_000);
const audience = z.enum(['household', 'adults']);
const item = z.strictObject({ id: z.uuid().optional(), title, done: z.boolean().default(false) });
export const Checklist = z
  .array(item)
  .max(200)
  .refine(
    (items) =>
      new Set(items.flatMap((value) => (value.id ? [value.id] : []))).size ===
      items.filter((value) => value.id).length,
  );
export const CreateNote = z.strictObject({
  title,
  body: body.default(''),
  pinned: z.boolean().default(false),
  checklist: Checklist.default([]),
  placement: z.strictObject({ spaceId: z.uuid(), audience: audience.optional() }).optional(),
  /** Контекст создания из карточки: пока объектом-примером служит tasks. Постоянные связи — R0.5. */
  object: z.strictObject({ type: z.literal('task'), id: z.uuid() }).optional(),
});
export const PatchNote = z
  .strictObject({
    title: title.optional(),
    body: body.optional(),
    pinned: z.boolean().optional(),
    assigneeId: z.uuid().optional(),
    checklist: Checklist.optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine((value) =>
    ['title', 'body', 'pinned', 'assigneeId', 'checklist'].some((key) => key in value),
  );
export const ShareNote = z.strictObject({
  spaceId: z.uuid(),
  audience: audience.default('household'),
});
export const AudienceChange = z.strictObject({ audience, confirmed: z.boolean().optional() });
export const Confirm = z.strictObject({ confirmed: z.boolean() });
export const Preview = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('personal') }),
  z.strictObject({ action: z.literal('audience'), audience }),
]);
export const ListNotes = z.strictObject({
  scope: z.enum(['all', 'personal', 'household']).default('all'),
  spaceId: z.uuid().optional(),
  trash: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50_000).default(0),
});
export const Id = z.strictObject({ id: z.uuid() });
