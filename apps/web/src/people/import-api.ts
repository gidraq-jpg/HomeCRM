import { PersonData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import type { Placement } from '../notes/api.ts';

export const ImportPreview = z.object({
  previewHash: z.string(),
  placement: z.object({
    spaceId: z.string(),
    spaceKind: z.enum(['personal', 'household']),
    audience: z.enum(['household', 'adults']).nullable(),
  }),
  items: z.array(
    z.object({
      index: z.number().int(),
      title: z.string(),
      data: PersonData,
      organization: z.string().nullable(),
      matches: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          updatedAt: z.string(),
          canMerge: z.boolean(),
        }),
      ),
    }),
  ),
});
export type ImportPreview = z.infer<typeof ImportPreview>;
export type ImportFile = { fileName: string; content: string; placement?: Placement };
export type ImportChoice =
  | { index: number; action: 'create' }
  | { index: number; action: 'merge'; contactId: string; updatedAt: string };

export function previewImport(file: ImportFile) {
  return apiRequest('POST', 'contacts/import', ImportPreview, file);
}
export function applyImport(
  file: ImportFile,
  previewHash: string,
  choices: ImportChoice[],
  idempotencyKey: string,
) {
  return apiRequest(
    'POST',
    'contacts/import',
    z.object({ contactIds: z.array(z.string()), replayed: z.boolean() }),
    {
      ...file,
      mode: 'apply',
      previewHash,
      choices,
      idempotencyKey,
    },
  );
}
