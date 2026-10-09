import { RECORD_TYPES } from '@homecrm/db';
import { OBJECT_TYPES, PropertyData } from '@homecrm/shared';
import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const audience = z.enum(['household', 'adults']);
export const Reference = z.strictObject({ type: z.enum(RECORD_TYPES), id: z.uuid() });
export const Id = z.strictObject({ id: z.uuid() });
export const EventId = Id.extend({ eventId: z.uuid() });
export const Field = z.strictObject({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  value: z.string().max(4000),
});
export const Fields = z
  .array(Field)
  .max(50)
  .refine((items) => {
    const ids = items.flatMap((item) => (item.id ? [item.id] : []));
    return ids.length === new Set(ids).size;
  });
export const CreateObject = z.strictObject({
  title,
  objectType: z.enum(OBJECT_TYPES).default('other'),
  fields: Fields.default([]),
  typeData: PropertyData.optional(),
  assigneeId: z.uuid().optional(),
  placement: z.strictObject({ spaceId: z.uuid(), audience: audience.optional() }).optional(),
});
export const PatchObject = z
  .strictObject({
    title: title.optional(),
    objectType: z.enum(OBJECT_TYPES).optional(),
    assigneeId: z.uuid().nullable().optional(),
    responsibleId: z.uuid().nullable().optional(),
    fields: Fields.optional(),
    typeData: PropertyData.optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine((body) =>
    ['title', 'objectType', 'assigneeId', 'responsibleId', 'fields', 'typeData'].some(
      (key) => key in body,
    ),
  )
  .refine(
    (body) =>
      body.assigneeId === undefined ||
      body.responsibleId === undefined ||
      body.assigneeId === body.responsibleId,
  );
export const ListObjects = z.strictObject({
  scope: z.enum(['all', 'personal', 'household']).default('all'),
  spaceId: z.uuid().optional(),
  objectType: z.enum(OBJECT_TYPES).optional(),
  trash: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50000).default(0),
});
export const Share = z.strictObject({ spaceId: z.uuid(), audience: audience.default('household') });
export const Confirm = z.strictObject({ confirmed: z.boolean().optional() });
export const AudienceChange = Confirm.extend({ audience });
export const Preview = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('personal') }),
  z.strictObject({ action: z.literal('audience'), audience }),
]);
export const CreateLink = z
  .strictObject({ left: Reference, right: Reference, role: z.string().trim().max(200).default('') })
  .refine((body) => body.left.type !== body.right.type || body.left.id !== body.right.id);
export const PatchLink = z.strictObject({ role: z.string().trim().max(200) });
const eventFields = {
  occurredOn: z.iso.date(),
  text: z.string().trim().min(1).max(10000),
  amountKopecks: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  contact: Reference.refine((ref) => ref.type !== 'object_event')
    .nullable()
    .optional(),
};
export const CreateEvent = z.strictObject(eventFields);
export const PatchEvent = CreateEvent.partial()
  .extend({ expectedUpdatedAt: z.iso.datetime().optional() })
  .refine((body) => Object.keys(eventFields).some((key) => key in body));
export const TimelineCursor = z.strictObject({
  at: z.iso.datetime(),
  source: z.enum(['object', 'field', 'manual', 'reading', 'interaction']),
  id: z.uuid(),
});
export const ListTimeline = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
});
