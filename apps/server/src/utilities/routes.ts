import { and, contacts, eq, isNull, sql, type Transaction, utilityAccounts } from '@homecrm/db';
import {
  canCreate,
  canRestore,
  canTrash,
  canView,
  ORGANIZATION_TYPES,
  OrganizationData,
  UtilityAccountData,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { getObject } from '../objects/routes.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  factsOf,
  missing,
  parse,
  placementFrom,
  placementOf,
  requireWrite,
  version,
} from '../objects/support.ts';
import { meterRoutes } from './meters.ts';
import { accountSummary, contactSummary, defaultHousePlacement, provider } from './service.ts';

const Id = z.strictObject({ id: z.uuid() });
const title = z.string().trim().min(1).max(200);
const CreateContact = z.strictObject({
  title,
  kind: z.literal('organization').default('organization'),
  data: OrganizationData.default(() => OrganizationData.parse({})),
  placement: z
    .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
    .optional(),
});
const PatchContact = z
  .strictObject({
    title: title.optional(),
    data: OrganizationData.optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine((body) => body.title !== undefined || body.data !== undefined);
const CreateAccount = z.strictObject({
  title: title.default('Лицевой счёт'),
  supplierId: z.uuid().nullable().default(null),
  data: UtilityAccountData.default(() => UtilityAccountData.parse({})),
});
const PatchAccount = z
  .strictObject({
    title: title.optional(),
    supplierId: z.uuid().nullable().optional(),
    data: UtilityAccountData.optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine(
    (body) => body.title !== undefined || body.data !== undefined || body.supplierId !== undefined,
  );
const List = z.strictObject({
  trash: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50000).default(0),
});

export async function utilityRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  await meterRoutes(route);
  route('POST', '/api/contacts', 201, async (tx, account, request) => {
    const body = parse(CreateContact, request.body);
    const place = body.placement
      ? await placementFrom(tx, account, body.placement.spaceId, body.placement.audience)
      : await defaultHousePlacement(tx, account, 'household');
    if (!canCreate(account.viewer, { type: 'contact', placement: place, authorId: account.id }))
      deny();
    const [row] = await tx
      .insert(contacts)
      .values({
        ...columnsOf(place),
        title: body.title,
        kind: body.kind,
        data: body.data,
        authorId: account.id,
      })
      .returning();
    if (!row) deny();
    return contactSummary(row);
  });
  route('GET', '/api/contacts', 200, async (tx, account, request) => {
    const query = parse(
      List.extend({ organizationType: z.enum(ORGANIZATION_TYPES).optional() }),
      request.query,
    );
    const rows = await tx
      .select()
      .from(contacts)
      .where(
        and(
          query.trash === 'true'
            ? sql`${contacts.deletedAt} IS NOT NULL`
            : isNull(contacts.deletedAt),
          query.organizationType
            ? sql`${contacts.data}->>'organizationType'=${query.organizationType}`
            : undefined,
        ),
      )
      .orderBy(contacts.title, contacts.id)
      .limit(query.limit)
      .offset(query.offset);
    return rows.filter((row) => canView(account.viewer, placementOf(row))).map(contactSummary);
  });
  route('GET', '/api/objects/:id/accounts', 200, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id);
    const query = parse(List, request.query);
    const rows = await tx
      .select()
      .from(utilityAccounts)
      .where(
        and(
          eq(utilityAccounts.parentId, parent.id),
          query.trash === 'true'
            ? sql`${utilityAccounts.deletedAt} IS NOT NULL`
            : isNull(utilityAccounts.deletedAt),
        ),
      )
      .orderBy(utilityAccounts.createdAt, utilityAccounts.id)
      .limit(query.limit)
      .offset(query.offset);
    const result = [];
    for (const row of rows)
      if (canView(account.viewer, placementOf(row)))
        result.push(await accountSummary(tx, account, row));
    return result;
  });
  route('POST', '/api/objects/:id/accounts', 201, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, parent);
    const body = parse(CreateAccount, request.body);
    await provider(tx, account, body.supplierId);
    const [row] = await tx
      .insert(utilityAccounts)
      .values({
        ...columnsOf(placementOf(parent)),
        parentId: parent.id,
        authorId: account.id,
        title: body.title,
        supplierId: body.supplierId,
        data: body.data,
      })
      .returning();
    if (!row) deny();
    return accountSummary(tx, account, row);
  });
  for (const type of ['contact', 'utility_account'] as const) {
    const table = type === 'contact' ? contacts : utilityAccounts;
    const path = type === 'contact' ? 'contacts' : 'accounts';
    const read = async (tx: Transaction, account: Account, id: string, lock = false) => {
      const [row] = await tx.select().from(table).where(eq(table.id, id));
      if (!row || !canView(account.viewer, placementOf(row))) missing();
      if ('parentId' in row) await getObject(tx, account, row.parentId, lock);
      if (!lock) return row;
      const [locked] = await tx.select().from(table).where(eq(table.id, id)).for('update');
      if (!locked) deny();
      if (!canView(account.viewer, placementOf(locked))) missing();
      return locked;
    };
    const summary = (tx: Transaction, account: Account, row: Awaited<ReturnType<typeof read>>) =>
      'parentId' in row ? accountSummary(tx, account, row) : contactSummary(row);
    route('GET', `/api/${path}/:id`, 200, async (tx, account, request) =>
      summary(tx, account, await read(tx, account, parse(Id, request.params).id)),
    );
    route('PATCH', `/api/${path}/:id`, 200, async (tx, account, request) => {
      const id = parse(Id, request.params).id;
      const body =
        type === 'contact' ? parse(PatchContact, request.body) : parse(PatchAccount, request.body);
      const row = await read(tx, account, id, true);
      requireWrite(account, row, type);
      if ('parentId' in row && (await getObject(tx, account, row.parentId)).deletedAt !== null)
        deny();
      version(body.expectedUpdatedAt, row.updatedAt);
      if ('supplierId' in body && body.supplierId !== undefined)
        await provider(tx, account, body.supplierId);
      const { expectedUpdatedAt: _expected, ...changes } = body;
      // Скрытый поставщик приходит клиенту как null: такая правка сохраняет чужую ссылку.
      if (
        'supplierId' in changes &&
        changes.supplierId === null &&
        'supplierId' in row &&
        row.supplierId
      ) {
        const current = await accountSummary(tx, account, row);
        if (current.supplier === null) delete changes.supplierId;
      }
      const [updated] = await tx.update(table).set(changes).where(eq(table.id, id)).returning();
      if (!updated) deny();
      return summary(tx, account, updated);
    });
    for (const action of ['trash', 'restore'] as const) {
      const handler = async (
        tx: Transaction,
        account: Account,
        request: { params: unknown; body?: unknown },
      ) => {
        parse(z.strictObject({}), request.body ?? {});
        const row = await read(tx, account, parse(Id, request.params).id, true);
        if (
          action === 'trash'
            ? !canTrash(account.viewer, factsOf(row, type))
            : !canRestore(account.viewer, factsOf(row, type))
        )
          deny();
        if ('parentId' in row && (await getObject(tx, account, row.parentId)).deletedAt !== null)
          deny();
        const [updated] = await tx
          .update(table)
          .set({ deletedAt: action === 'trash' ? new Date() : null })
          .where(eq(table.id, row.id))
          .returning();
        if (!updated) deny();
        return summary(tx, account, updated);
      };
      route('POST', `/api/${path}/:id/${action}`, 200, handler);
      if (action === 'trash') route('DELETE', `/api/${path}/:id`, 200, handler);
    }
  }
}
