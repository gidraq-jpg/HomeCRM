import { z } from 'zod';

export {
  NoteChecklist as Checklist,
  NoteCreate as CreateNote,
  NotePatch as PatchNote,
} from '@homecrm/shared';

const audience = z.enum(['household', 'adults']);
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
  offline: z.literal('true').optional(),
});
export const Id = z.strictObject({ id: z.uuid() });
