import {
  and,
  desc,
  eq,
  isNull,
  recordLinks,
  shoppingItems,
  sql,
  type Transaction,
} from '@homecrm/db';
import {
  canChangeAudience,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  canWriteLink,
  ShoppingCreate,
  ShoppingPatch,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { beginOperation, fingerprint, finishReceipt, receiptOf } from '../idempotency.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  Failure,
  factsOf,
  missing,
  parse,
  placementFrom,
  placementOf,
  readReference,
  requireWrite,
  tableForType,
  version,
} from '../objects/support.ts';
import { publicRecord } from '../utilities/service.ts';

const Id = z.strictObject({ id: z.uuid() });
const Mutation = z.strictObject({
  expectedUpdatedAt: z.iso.datetime().optional(),
  idempotencyKey: z.uuid().optional(),
});
type Shopping = typeof shoppingItems.$inferSelect;
function summary(row: Shopping) {
  return {
    ...publicRecord(row),
    quantity: row.quantity,
    data: row.data,
    boughtAt: row.boughtAt,
    hasOtherContributions: row.hasOtherContributions,
  };
}
async function get(tx: Transaction, account: Account, id: string, lock = false) {
  const query = tx.select().from(shoppingItems).where(eq(shoppingItems.id, id));
  const [visible] = await query;
  if (!visible || !canView(account.viewer, placementOf(visible))) missing();
  const [row] = lock ? await query.for('update') : [visible];
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  return row;
}
export async function shoppingRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('GET', '/api/shopping', 200, async (tx, account, request) => {
    const q = parse(
      z.strictObject({
        scope: z.enum(['all', 'household', 'personal']).default('household'),
        spaceId: z.uuid().optional(),
        trash: z.enum(['true', 'false']).default('false'),
        bought: z.enum(['all', 'true', 'false']).default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(50000).default(0),
      }),
      request.query,
    );
    let spaceId = q.spaceId;
    if (spaceId) await placementFrom(tx, account, spaceId);
    if (q.scope === 'household' && !spaceId) {
      const houses = [...account.viewer.memberships.keys()];
      if (houses.length > 1) throw new Failure(400, 'HOUSE_REQUIRED');
      spaceId = houses[0];
      if (!spaceId) return [];
    }
    const rows = await tx
      .select()
      .from(shoppingItems)
      .where(
        and(
          q.scope === 'all' ? undefined : eq(shoppingItems.spaceKind, q.scope),
          spaceId ? eq(shoppingItems.spaceId, spaceId) : undefined,
          q.trash === 'true'
            ? sql`${shoppingItems.deletedAt} IS NOT NULL`
            : isNull(shoppingItems.deletedAt),
          q.bought === 'all'
            ? undefined
            : q.bought === 'true'
              ? sql`${shoppingItems.boughtAt} IS NOT NULL`
              : isNull(shoppingItems.boughtAt),
        ),
      )
      .orderBy(
        sql`bought_at IS NOT NULL`,
        desc(shoppingItems.boughtAt),
        shoppingItems.createdAt,
        shoppingItems.id,
      )
      .limit(q.limit)
      .offset(q.offset);
    return rows
      .filter((row) => canView(account.viewer, placementOf(row)))
      .map((row) => ({
        ...summary(row),
        canRestore: !!row.deletedAt && canRestore(account.viewer, factsOf(row, 'shopping_item')),
      }));
  });
  route('GET', '/api/shopping/:id', 200, async (tx, account, request) =>
    summary(await get(tx, account, parse(Id, request.params).id)),
  );
  route('POST', '/api/shopping', 201, async (tx, account, request) => {
    const body = parse(ShoppingCreate, request.body),
      hash = fingerprint(body);
    const prior = await beginOperation(
      tx,
      account.id,
      body.idempotencyKey,
      'shopping_create',
      hash,
    );
    if (prior) {
      const row = await get(tx, account, prior[0] ?? '');
      requireWrite(account, row, 'shopping_item');
      return { ...summary(row), receipt: await receiptOf(tx, account.id, body.idempotencyKey) };
    }
    const place = await placementFrom(
      tx,
      account,
      body.placement?.spaceId,
      body.placement?.audience,
    );
    if (
      !canCreate(account.viewer, { type: 'shopping_item', placement: place, authorId: account.id })
    )
      deny();
    const [row] = await tx
      .insert(shoppingItems)
      .values({
        ...columnsOf(place),
        title: body.title,
        quantity: body.quantity,
        data: body.data,
        authorId: account.id,
      })
      .returning();
    if (!row) deny();
    const seen = new Set<string>();
    for (const link of body.links) {
      const key = `${link.type}:${link.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = await readReference(tx, account, link);
      if (target.row.deletedAt) missing();
      if (!canWriteLink(account.viewer, factsOf(row, 'shopping_item'), target.facts)) deny();
      await tx.insert(recordLinks).values({
        leftTable: 'shopping_items',
        leftId: row.id,
        rightTable: tableForType(link.type),
        rightId: link.id,
        role: link.role,
        authorId: account.id,
      });
    }
    const receipt = await finishReceipt(
      tx,
      account.id,
      body.idempotencyKey,
      'shopping_create',
      hash,
      [row],
      { table: 'shopping_items' },
    );
    return { ...summary(row), receipt };
  });
  route('PATCH', '/api/shopping/:id', 200, async (tx, account, request) => {
    const id = parse(Id, request.params).id,
      body = parse(ShoppingPatch, request.body),
      hash = fingerprint({ id, body });
    const prior = await beginOperation(tx, account.id, body.idempotencyKey, 'shopping_patch', hash);
    const row = await get(tx, account, id, !prior);
    requireWrite(account, row, 'shopping_item');
    if (prior)
      return { ...summary(row), receipt: await receiptOf(tx, account.id, body.idempotencyKey) };
    version(body.expectedUpdatedAt, row.updatedAt);
    const { expectedUpdatedAt: _version, idempotencyKey: _key, ...fields } = body;
    const [result] = await tx
      .update(shoppingItems)
      .set(fields)
      .where(eq(shoppingItems.id, id))
      .returning();
    if (!result) deny();
    const receipt = await finishReceipt(
      tx,
      account.id,
      body.idempotencyKey,
      'shopping_patch',
      hash,
      [result],
      { table: 'shopping_items' },
    );
    return { ...summary(result), receipt };
  });
  route('POST', '/api/shopping/:id/bought', 200, async (tx, account, request) => {
    const id = parse(Id, request.params).id,
      body = parse(Mutation.extend({ bought: z.boolean() }), request.body),
      hash = fingerprint({ id, body });
    const prior = await beginOperation(
      tx,
      account.id,
      body.idempotencyKey,
      'shopping_bought',
      hash,
    );
    const row = await get(tx, account, id, !prior);
    requireWrite(account, row, 'shopping_item');
    if (prior)
      return { ...summary(row), receipt: await receiptOf(tx, account.id, body.idempotencyKey) };
    version(body.expectedUpdatedAt, row.updatedAt);
    let result = row;
    if (!!row.boughtAt !== body.bought) {
      const [changed] = await tx
        .update(shoppingItems)
        .set({ boughtAt: body.bought ? sql`clock_timestamp()` : null })
        .where(eq(shoppingItems.id, id))
        .returning();
      if (!changed) deny();
      result = changed;
    }
    const receipt = await finishReceipt(
      tx,
      account.id,
      body.idempotencyKey,
      'shopping_bought',
      hash,
      [result],
      { table: 'shopping_items' },
    );
    return { ...summary(result), receipt };
  });
  for (const action of ['trash', 'restore'] as const) {
    const handler = async (
      tx: Transaction,
      account: Account,
      request: { params: unknown; body?: unknown },
    ) => {
      const id = parse(Id, request.params).id,
        body = parse(Mutation, request.body ?? {}),
        hash = fingerprint({ id, body }),
        operation = `shopping_${action}`;
      const prior = await beginOperation(tx, account.id, body.idempotencyKey, operation, hash);
      const row = await get(tx, account, id, !prior);
      if (
        !(action === 'trash' ? canTrash : canRestore)(account.viewer, factsOf(row, 'shopping_item'))
      )
        deny();
      if (prior)
        return { ...summary(row), receipt: await receiptOf(tx, account.id, body.idempotencyKey) };
      version(body.expectedUpdatedAt, row.updatedAt);
      let result = row;
      if (!!row.deletedAt === (action === 'restore')) {
        const [changed] = await tx
          .update(shoppingItems)
          .set({ deletedAt: action === 'trash' ? new Date() : null })
          .where(eq(shoppingItems.id, id))
          .returning();
        if (!changed) deny();
        result = changed;
        // Сначала штатное восстановление: guard запрещает содержательную правку строки в корзине.
        if (action === 'restore' && result.boughtAt) {
          const [reset] = await tx
            .update(shoppingItems)
            .set({ boughtAt: null })
            .where(eq(shoppingItems.id, id))
            .returning();
          if (!reset) deny();
          result = reset;
        }
      }
      const receipt = await finishReceipt(
        tx,
        account.id,
        body.idempotencyKey,
        operation,
        hash,
        [result],
        { table: 'shopping_items' },
      );
      return { ...summary(result), receipt };
    };
    route('POST', `/api/shopping/:id/${action}`, 200, handler);
    if (action === 'trash') route('DELETE', '/api/shopping/:id', 200, handler);
  }
  route('POST', '/api/shopping/:id/move', 200, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        spaceId: z.uuid(),
        audience: z.enum(['household', 'adults']).optional(),
        confirmed: z.literal(true),
        expectedUpdatedAt: z.iso.datetime(),
      }),
      request.body,
    );
    const row = await get(tx, account, parse(Id, request.params).id, true),
      place = await placementFrom(tx, account, body.spaceId, body.audience);
    version(body.expectedUpdatedAt, row.updatedAt);
    if (
      !(row.spaceId === place.spaceId
        ? canChangeAudience(account.viewer, factsOf(row, 'shopping_item'), place)
        : canMove(account.viewer, factsOf(row, 'shopping_item'), place, row.hasOtherContributions))
    )
      deny();
    const [result] = await tx
      .update(shoppingItems)
      .set({ ...columnsOf(place), assigneeId: account.id })
      .where(eq(shoppingItems.id, row.id))
      .returning();
    if (!result) deny();
    return summary(result);
  });
  route('GET', '/api/shopping/:id/history', 200, async (tx, account, request) => {
    const row = await get(tx, account, parse(Id, request.params).id);
    return (
      await tx.execute(
        sql`SELECT * FROM shopping_items_history WHERE record_id=${row.id}::uuid ORDER BY created_at,id`,
      )
    ).rows;
  });
}
