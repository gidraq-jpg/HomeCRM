import { z } from 'zod';

export const ShoppingData = z.strictObject({
  note: z.string().max(10000).default(''),
  store: z.string().trim().max(200).default(''),
  category: z.string().trim().max(200).default(''),
});
export type ShoppingData = z.infer<typeof ShoppingData>;
export const ShoppingFields = z.strictObject({
  title: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(200).nullable().default(null),
  data: ShoppingData.default({ note: '', store: '', category: '' }),
});
export const ShoppingLink = z.strictObject({
  type: z.enum(['task', 'object']),
  id: z.uuid(),
  role: z.string().trim().max(200).default(''),
});
export const ShoppingCreate = ShoppingFields.extend({
  placement: z
    .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
    .optional(),
  links: z.array(ShoppingLink).max(100).default([]),
  idempotencyKey: z.uuid().optional(),
});
export const ShoppingPatch = z
  .strictObject({
    title: ShoppingFields.shape.title.optional(),
    quantity: z.string().trim().max(200).nullable().optional(),
    data: ShoppingData.optional(),
  })
  .extend({
    expectedUpdatedAt: z.iso.datetime().optional(),
    idempotencyKey: z.uuid().optional(),
  })
  .refine((body) => ['title', 'quantity', 'data'].some((key) => key in body));
