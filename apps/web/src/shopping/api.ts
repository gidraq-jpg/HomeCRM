import { ShoppingCreate, ShoppingData, ShoppingPatch } from '@homecrm/shared';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
export const ShoppingCard = z.object({
  id: z.uuid(),
  title: z.string(),
  quantity: z.string().nullable(),
  data: ShoppingData,
  spaceId: z.uuid(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(['household', 'adults']).nullable(),
  authorId: z.uuid(),
  assigneeId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  boughtAt: z.string().nullable(),
  hasOtherContributions: z.boolean(),
});
export type ShoppingCard = z.infer<typeof ShoppingCard>;
export function fetchShopping(
  scope: string,
  spaceId: string | null,
  trash: boolean,
  offset: number,
  signal?: AbortSignal,
): Promise<ShoppingCard[]> {
  if (scope === 'all' && spaceId) {
    return Promise.all([
      fetchShopping('household', spaceId, trash, offset, signal),
      fetchShopping('personal', null, trash, offset, signal),
    ]).then((pages) => pages.flat());
  }
  const query = new URLSearchParams({
    scope,
    trash: String(trash),
    bought: 'all',
    limit: '100',
    offset: String(offset),
  });
  if (spaceId && scope !== 'personal') query.set('spaceId', spaceId);
  return apiRequest('GET', `shopping?${query}`, z.array(ShoppingCard), undefined, signal);
}
export function fetchShoppingCard(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `shopping/${id}`, ShoppingCard, undefined, signal);
}
export function createShopping(body: z.input<typeof ShoppingCreate>) {
  return apiRequest('POST', 'shopping', ShoppingCard, ShoppingCreate.parse(body));
}
export function patchShopping(id: string, body: z.input<typeof ShoppingPatch>) {
  return apiRequest('PATCH', `shopping/${id}`, ShoppingCard, ShoppingPatch.parse(body));
}
export function shoppingAction(
  card: ShoppingCard,
  action: 'bought' | 'trash' | 'restore',
  key: string,
  bought?: boolean,
) {
  return apiRequest('POST', `shopping/${card.id}/${action}`, ShoppingCard, {
    expectedUpdatedAt: card.updatedAt,
    idempotencyKey: key,
    ...(action === 'bought' ? { bought } : {}),
  });
}
