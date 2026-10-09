import { z } from 'zod';
import { BillingPeriod, Cents, ChargeLine, PAYMENT_METHODS, PaymentInput } from './charges.ts';
import { INTERACTION_KINDS, PersonData } from './contacts.ts';
import { DeadlineRule, TimeZone } from './deadlines.ts';
import { DocumentData } from './documents.ts';
import { DecimalValue, MeterData } from './meters.ts';
import { NotificationSettings } from './notifications.ts';
import { OrganizationData, UtilityAccountData } from './utilities.ts';

export const EXPORT_VERSION = 1;
export const ExportScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal') }),
  z.strictObject({ kind: z.literal('household'), householdId: z.uuid() }),
]);
export type ExportScope = z.infer<typeof ExportScope>;
export const ExportRequest = z.strictObject({
  scope: ExportScope,
  password: z.string().min(1).max(1000),
  confirmed: z.literal(true),
});
export const ExportManifest = z.strictObject({
  format: z.literal('homecrm'),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  timeZone: TimeZone,
  scope: ExportScope,
  includesTrash: z.literal(true),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

export const ExportEvent = z.strictObject({
  id: z.uuid(),
  account_id: z.uuid(),
  kind: z.enum(['personal', 'household']),
  household_id: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  size_bytes: z.number().int().safe().nonnegative(),
});
export const ExportHistoryItem = ExportEvent.extend({ actor_name: z.string().nullable() });

// Имена колонок сохраняются как в БД; технические поля и ключи в формат не входят.
const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const place = {
  space_id: uuid,
  space_kind: z.enum(['personal', 'household']),
  audience: z.enum(['household', 'adults']).nullable(),
};
const record = {
  id: uuid,
  ...place,
  author_id: uuid,
  assignee_id: uuid.nullable(),
  title: z.string(),
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
};
const file = {
  id: uuid,
  title: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  created_at: instant,
  deleted_at: instant.nullable(),
  archive_path: z.string().startsWith('files/'),
};
const reference = z.strictObject({ table: z.string(), id: uuid });
export const ExportRecords = {
  export_events: ExportEvent,
  notes: z.strictObject({ ...record, body: z.string(), pinned: z.boolean() }),
  documents: z.strictObject({
    ...record,
    data: DocumentData,
    owner_account_id: uuid.nullable(),
    owner_contact_id: uuid.nullable(),
    owner_object_id: uuid.nullable(),
    previous_id: uuid.nullable(),
    status: z.enum(['valid', 'invalid']),
  }),
  note_items: z.strictObject({
    ...record,
    parent_id: uuid,
    done: z.boolean(),
    position: z.number().int(),
  }),
  contacts: z.discriminatedUnion('kind', [
    z.strictObject({
      ...record,
      kind: z.literal('organization'),
      data: OrganizationData,
      organization_id: uuid.nullable(),
    }),
    z.strictObject({
      ...record,
      kind: z.literal('person'),
      data: PersonData,
      organization_id: uuid.nullable(),
    }),
  ]),
  contact_interactions: z.strictObject({
    ...record,
    parent_id: uuid,
    kind: z.enum(INTERACTION_KINDS),
    occurred_on: z.iso.date(),
    amount_cents: Cents.nonnegative().nullable(),
    call_again: z.boolean().nullable(),
    object_id: uuid.nullable(),
  }),
  meters: z.strictObject({
    ...record,
    parent_id: uuid,
    utility_account_id: uuid.nullable(),
    previous_meter_id: uuid.nullable(),
    data: MeterData,
  }),
  meter_readings: z.strictObject({
    ...record,
    parent_id: uuid,
    occurred_on: z.iso.date(),
    values: z.array(DecimalValue),
    consumption: z.array(DecimalValue).nullable(),
    rollover: z.boolean(),
    comment: z.string(),
    transmitted_at: instant.nullable(),
    transmission_method: z.string().nullable(),
  }),
  utility_charges: z.strictObject({
    ...record,
    parent_id: uuid,
    period: BillingPeriod,
    total_cents: Cents.nonnegative(),
    lines: z.array(ChargeLine),
    due_on: z.iso.date(),
    cancelled_at: instant.nullable(),
    cancellation_reason: z.string().nullable(),
  }),
  utility_payments: z.strictObject({
    ...record,
    parent_id: uuid,
    paid_on: z.iso.date(),
    amount_cents: Cents.positive(),
    payer: PaymentInput.shape.payer,
    method: z.enum(PAYMENT_METHODS),
    cancelled_at: instant.nullable(),
    cancellation_reason: z.string().nullable(),
  }),
  utility_accounts: z.strictObject({
    ...record,
    parent_id: uuid,
    supplier_id: uuid.nullable(),
    data: UtilityAccountData,
  }),
  objects: z.strictObject({
    ...record,
    object_type: z.enum(['property', 'car', 'appliance', 'other']),
    type_data: z.json(),
  }),
  object_fields: z.strictObject({
    ...record,
    parent_id: uuid,
    value: z.string(),
    position: z.number().int(),
  }),
  object_events: z.strictObject({
    ...record,
    parent_id: uuid,
    occurred_on: z.iso.date(),
    amount_kopecks: z.number().int().safe().nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    origin_space_id: uuid,
    origin_space_kind: z.enum(['personal', 'household']),
    origin_audience: z.enum(['household', 'adults']).nullable(),
    contact: reference.nullable(),
  }),
  tasks: z.strictObject({ ...record, due_at: instant.nullable(), done_at: instant.nullable() }),
  shopping_items: z.strictObject({
    ...record,
    quantity: z.string().nullable(),
    bought_at: instant.nullable(),
  }),
  note_files: z.strictObject({ ...record, ...file, parent_id: uuid }),
  object_files: z.strictObject({ ...record, ...file, parent_id: uuid }),
  document_files: z.strictObject({ ...record, ...file, parent_id: uuid }),
  profile_files: z.strictObject({ ...file, account_id: uuid }),
  record_links: z.strictObject({
    id: uuid,
    left_table: z.string(),
    left_id: uuid,
    right_table: z.string(),
    right_id: uuid,
    role: z.string(),
    author_id: uuid,
    created_at: instant,
    updated_at: instant,
    deleted_at: instant.nullable(),
  }),
  deadlines: z.strictObject({
    id: uuid,
    ...place,
    author_id: uuid,
    assignee_id: uuid,
    deleted_at: instant.nullable(),
    note_id: uuid.nullable(),
    object_id: uuid.nullable(),
    document_id: uuid.nullable().default(null),
    source_kind: z
      .enum(['record', 'readings', 'payment', 'verification', 'document'])
      .default('record'),
    utility_account_id: uuid.nullable().default(null),
    meter_id: uuid.nullable().default(null),
    charge_id: uuid.nullable().default(null),
    label: z.string().nullable().default(null),
    household_id: uuid,
    rule: DeadlineRule,
    created_at: instant,
    updated_at: instant,
  }),
  // Наступления производные, но выполненность — данные человека, её сохраняем отдельно.
  deadline_completions: z.strictObject({
    id: uuid,
    deadline_id: uuid,
    date: z.iso.date(),
    completed_at: instant,
  }),
  history: z.strictObject({
    id: uuid,
    ...place,
    table: z.string(),
    record_id: uuid,
    actor_id: uuid.nullable(),
    created_at: instant,
    operation: z.enum(['create', 'update', 'trash', 'restore', 'move', 'audience']),
    changes: z.record(z.string(), z.json()),
  }),
  profile: z.strictObject({
    account_id: uuid,
    display_name: z.string(),
    username: z.string().nullable(),
    email: z.string().nullable(),
    birth_date: z.iso.date().nullable(),
    phone: z.string().nullable(),
    photo_file_id: uuid.nullable(),
  }),
  notification_settings: NotificationSettings,
  household: z.strictObject({
    id: uuid,
    name: z.string(),
    time_zone: TimeZone,
    created_at: instant,
  }),
  members: z.strictObject({
    account_id: uuid,
    display_name: z.string(),
    role: z.enum(['admin', 'adult', 'child']),
    created_at: instant,
    left_at: instant.nullable(),
    left_by: uuid.nullable(),
  }),
};
