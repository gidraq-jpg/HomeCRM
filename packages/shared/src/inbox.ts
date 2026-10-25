import { z } from 'zod';

export const INBOX_KINDS = [
  'task',
  'shopping',
  'note',
  'meter',
  'receipt',
  'document',
  'medical',
] as const;
export const INBOX_STATUSES = ['new', 'processing', 'ready', 'error', 'identity'] as const;
export const INBOX_MAX_BYTES = 10 * 1024 * 1024;
const field = <T extends z.ZodType>(value: T) => z.strictObject({ value, confident: z.boolean() });
export const InboxClassification = z.strictObject({
  kind: z.enum(INBOX_KINDS),
  shoppingText: z.string().max(2000).nullable().default(null),
  objectId: field(z.uuid().nullable()),
  personId: field(z.uuid().nullable()),
  meterId: field(z.uuid().nullable()),
  newObject: z
    .strictObject({
      title: z.string().min(1).max(500),
      objectType: z.enum(['property', 'car', 'appliance', 'other']),
    })
    .nullable(),
});
export type InboxClassification = z.infer<typeof InboxClassification>;
export const DocumentDraft = z.strictObject({
  type: field(
    z.enum([
      'osago',
      'kasko',
      'property_insurance',
      'sts',
      'pts',
      'egrn',
      'contract',
      'warranty_receipt',
      'medical',
      'school',
      'certificate',
      'other',
    ]),
  ),
  title: field(z.string().min(1).max(500)),
  issuedOn: field(z.iso.date().nullable()),
  expiresOn: field(z.iso.date().nullable()),
  ownerId: field(z.uuid().nullable()),
  fields: z
    .array(z.strictObject({ name: z.string().max(100), value: field(z.string().max(2000)) }))
    .max(30),
});
export type DocumentDraft = z.infer<typeof DocumentDraft>;
export const InboxCapture = z.strictObject({
  id: z.uuid(),
  source: z.enum(['photo', 'file', 'text', 'voice']),
  text: z.string().max(20000).default(''),
  houseId: z.uuid().nullable().default(null),
  consent: z.string().max(200).nullable().default(null),
  files: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(255),
        base64: z.string().max(14 * 1024 * 1024),
      }),
    )
    .max(20)
    .default([]),
});
