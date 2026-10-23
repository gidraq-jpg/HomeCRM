import { z } from 'zod';

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
export const DraftSchemas = {
  task: TaskDraft,
  shopping: z.array(ShoppingDraft).min(1).max(100),
  note: NoteDraft,
};
export type DraftKind = keyof typeof DraftSchemas;
export type TaskDraft = z.infer<typeof TaskDraft>;
export type ShoppingDraft = z.infer<typeof ShoppingDraft>;
export type NoteDraft = z.infer<typeof NoteDraft>;
export type Draft = TaskDraft | ShoppingDraft[] | NoteDraft;
export const AiStatus = z.object({
  enabled: z.boolean(),
  speech: z.boolean(),
  extraction: z.boolean(),
  remaining: z.number().int().nonnegative(),
});
export const ExtractInput = z.strictObject({
  kind: z.enum(['task', 'shopping', 'note']),
  text: z.string().trim().min(1).max(20000),
  spaceId: z.uuid(),
});
