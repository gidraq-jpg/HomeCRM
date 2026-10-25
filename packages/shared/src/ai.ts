import { z } from 'zod';
import { BillingPeriod, Cents } from './charges.ts';
import { CalendarDate } from './deadlines.ts';
import { UtilityAccountData } from './utilities.ts';

const field = <T extends z.ZodType>(value: T) => z.strictObject({ value, confident: z.boolean() });
const title = z.string().trim().min(1).max(500);
export const TaskDraft = z.strictObject({
  title: field(title),
  date: field(z.iso.date().nullable()),
  time: field(
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
  ),
  assigneeId: field(z.uuid().nullable()),
  objectId: field(z.uuid().nullable()),
});
export const ShoppingDraft = z.strictObject({
  title: field(title),
  quantity: field(z.string().max(100).nullable()),
});
export const NoteDraft = z.strictObject({
  title: field(title),
  body: field(z.string().max(20000)),
});
export const MeterPhotoDraft = z.strictObject({
  values: z
    .array(
      field(
        z
          .string()
          .regex(/^\d{1,12}(\.\d{1,6})?$/)
          .nullable(),
      ),
    )
    .min(1)
    .max(3),
});
export type MeterPhotoDraft = z.infer<typeof MeterPhotoDraft>;
export const IdentityCheck = z.strictObject({ identity: z.enum(['yes', 'no', 'unsure']) });
export const ReceiptPhotoDraft = z.strictObject({
  supplier: field(z.string().max(500).nullable()),
  accountId: field(z.uuid().nullable()),
  period: field(BillingPeriod.nullable()),
  totalCents: field(Cents.nonnegative().nullable()),
  dueOn: field(CalendarDate.nullable()),
});
export type ReceiptPhotoDraft = z.infer<typeof ReceiptPhotoDraft>;
export const ReceiptAccount = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  objectId: z.uuid(),
  objectTitle: z.string(),
  data: UtilityAccountData,
});
export const ReceiptAccounts = z.array(ReceiptAccount);
export type ReceiptAccount = z.infer<typeof ReceiptAccount>;
export const DraftSchemas = {
  task: TaskDraft,
  shopping: z.array(ShoppingDraft).min(1).max(100),
  note: NoteDraft,
  meter: MeterPhotoDraft,
  identity: IdentityCheck,
  receipt: ReceiptPhotoDraft,
};
export const AutoDraft = z.discriminatedUnion('kind', [
  TaskDraft.extend({ kind: z.literal('task') }),
  ShoppingDraft.extend({ kind: z.literal('shopping') }),
  NoteDraft.extend({ kind: z.literal('note') }),
]);
export const AutoDrafts = z.array(AutoDraft).min(1).max(10);
export type AutoDraft = z.infer<typeof AutoDraft>;
export type DraftKind = keyof typeof DraftSchemas;
export type TaskDraft = z.infer<typeof TaskDraft>;
export type ShoppingDraft = z.infer<typeof ShoppingDraft>;
export type NoteDraft = z.infer<typeof NoteDraft>;
export type Draft =
  | TaskDraft
  | ShoppingDraft[]
  | NoteDraft
  | AutoDraft[]
  | MeterPhotoDraft
  | ReceiptPhotoDraft
  | z.infer<typeof IdentityCheck>;
export const AiStatus = z.object({
  provider: z.string(),
  enabled: z.boolean(),
  speech: z.boolean(),
  extraction: z.boolean(),
  remaining: z.number().int().nonnegative(),
});
export const ExtractInput = z.strictObject({
  kind: z.enum(['task', 'shopping', 'note', 'auto']),
  text: z.string().trim().min(1).max(20000),
  spaceId: z.uuid(),
  consent: z.literal(true),
});
