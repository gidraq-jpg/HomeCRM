import { z } from 'zod';

export const ChatItem = z
  .strictObject({
    kind: z.enum(['task', 'note', 'shopping', 'object', 'contact', 'meter']),
    title: z.string().trim().min(1).max(500),
    body: z.string().max(20000).default(''),
    date: z.iso.date().nullable().default(null),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    assigneeId: z.uuid().nullable().default(null),
    objectId: z.uuid().nullable().default(null),
    meterId: z.uuid().nullable().default(null),
    values: z
      .array(z.string().regex(/^\d{1,12}(\.\d{1,6})?$/))
      .min(1)
      .max(3)
      .optional(),
    quantity: z.string().max(100).nullable().default(null),
    objectType: z.enum(['property', 'car', 'appliance', 'other']).default('other'),
    uncertain: z
      .array(
        z.enum([
          'title',
          'body',
          'date',
          'time',
          'assigneeId',
          'objectId',
          'meterId',
          'values',
          'quantity',
          'objectType',
        ]),
      )
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.time && !v.date) ctx.addIssue({ code: 'custom', message: 'Время требует даты' });
    if (v.kind === 'meter' && (!v.meterId || !v.values))
      ctx.addIssue({ code: 'custom', message: 'Укажите счётчик и точные значения строками' });
  });
export type ChatItem = z.infer<typeof ChatItem>;
export const ChatBatch = z.strictObject({ items: z.array(ChatItem).min(1).max(20) });
