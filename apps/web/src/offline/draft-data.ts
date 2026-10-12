import { z } from 'zod';

export const DraftBase = z.strictObject({ id: z.uuid(), updatedAt: z.iso.datetime() });
export type DraftBase = z.infer<typeof DraftBase>;
export const DraftEnvelope = z.strictObject({
  format: z.literal(1),
  value: z.unknown(),
  base: DraftBase.nullable(),
});
