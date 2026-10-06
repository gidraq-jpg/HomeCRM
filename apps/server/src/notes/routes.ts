// Заметки читаются и меняются только под homecrm_app, в транзакции участника и под RLS.
import {
  accounts,
  and,
  desc,
  eq,
  isNull,
  noteItems,
  notes,
  spaceMembers,
  spaces,
  sql,
  type Transaction,
  tasks,
} from '@homecrm/db';
import {
  canChangeAudience,
  canCopyToPersonal,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  canWrite,
  type Placement,
  type RecordFacts,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { type Account, createAccountReader } from '../auth/account.ts';
import { pgError } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';
import {
  AudienceChange,
  Confirm,
  CreateNote,
  Id,
  ListNotes,
  PatchNote,
  Preview,
  ShareNote,
} from './schemas.ts';

type Note = typeof notes.$inferSelect;
type Item = typeof noteItems.$inferSelect;
class Failure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const denied = () => {
  throw new Failure(403, 'ACCESS_DENIED');
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Failure(400, 'INVALID_INPUT');
  return result.data;
}
export function placementOf(
  record: Pick<Note, 'spaceId' | 'spaceKind' | 'audience' | 'assigneeId'>,
): Placement {
  return record.spaceKind === 'personal'
    ? { kind: 'personal', spaceId: record.spaceId, ownerId: record.assigneeId ?? '' }
    : { kind: 'household', spaceId: record.spaceId, audience: record.audience ?? 'household' };
}
const factsOf = (record: Note): RecordFacts => ({
  type: 'note',
  placement: placementOf(record),
  authorId: record.authorId,
  assigneeId: record.assigneeId,
  trashed: record.deletedAt !== null,
});
const columnsOf = (placement: Placement) => ({
  spaceId: placement.spaceId,
  spaceKind: placement.kind,
  audience: placement.kind === 'household' ? placement.audience : null,
});
function summary(record: Note) {
  const {
    id,
    title,
    pinned,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  } = record;
  return {
    id,
    title,
    pinned,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
async function itemsOf(tx: Transaction, id: string): Promise<Item[]> {
  return tx
    .select()
    .from(noteItems)
    .where(eq(noteItems.parentId, id))
    .orderBy(noteItems.position, noteItems.id);
}
async function card(tx: Transaction, record: Note, includeDeleted = false) {
  return {
    ...summary(record),
    body: record.body,
    checklist: (await itemsOf(tx, record.id))
      .filter((item) => includeDeleted || record.deletedAt !== null || item.deletedAt === null)
      .map(({ id, title, done, position, deletedAt }) => ({
        id,
        title,
        done,
        position,
        deletedAt,
      })),
  };
}
async function personal(tx: Transaction, account: Account): Promise<Placement> {
  const [space] = await tx.select().from(spaces).where(eq(spaces.ownerAccountId, account.id));
  if (!space) throw new Failure(404, 'SPACE_NOT_FOUND');
  return { kind: 'personal', spaceId: space.id, ownerId: account.id };
}
async function get(tx: Transaction, account: Account, id: string, lock = true): Promise<Note> {
  const query = tx.select().from(notes).where(eq(notes.id, id));
  const [visible] = await query;
  if (!visible || !canView(account.viewer, placementOf(visible)))
    throw new Failure(404, 'NOT_FOUND');
  const [record] = lock ? await query.for('update') : [visible];
  if (!record) denied();
  if (!record || !canView(account.viewer, placementOf(record))) throw new Failure(404, 'NOT_FOUND');
  return record;
}
async function hasContributions(tx: Transaction, record: Note): Promise<boolean> {
  return (
    record.hasOtherContributions ||
    (await itemsOf(tx, record.id)).some(
      (item) => item.authorId !== record.authorId || item.hasOtherContributions,
    )
  );
}
async function replaceItems(
  tx: Transaction,
  account: Account,
  record: Note,
  incoming: z.infer<typeof CreateNote>['checklist'],
) {
  const old = await itemsOf(tx, record.id);
  for (let position = 0; position < incoming.length; position++) {
    const item = incoming[position];
    if (!item) continue;
    if (item.id) {
      const existing = old.find((value) => value.id === item.id);
      if (!existing) throw new Failure(400, 'INVALID_CHECKLIST_ITEM');
      const facts = {
        ...factsOf(record),
        type: 'note_item',
        authorId: existing.authorId,
        trashed: existing.deletedAt !== null,
      };
      if (
        existing.deletedAt !== null
          ? !canRestore(account.viewer, facts)
          : !canWrite(account.viewer, facts)
      )
        denied();
      if (existing.deletedAt !== null)
        await tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, item.id));
      await tx
        .update(noteItems)
        .set({ title: item.title, done: item.done, position, deletedAt: null })
        .where(eq(noteItems.id, item.id));
    } else {
      await tx.insert(noteItems).values({
        ...columnsOf(placementOf(record)),
        parentId: record.id,
        authorId: account.id,
        title: item.title,
        done: item.done,
        position,
      });
    }
  }
  for (const item of old)
    if (item.deletedAt === null && !incoming.some((next) => next.id === item.id))
      await tx.update(noteItems).set({ deletedAt: sql`now()` }).where(eq(noteItems.id, item.id));
}

/** Полный состав заметки в экспорте: своё личное и общее администрируемых домов (PRD 7.3.13). */
export async function exportNotes(tx: Transaction, account: Account) {
  const visible = await tx.select().from(notes);
  return Promise.all(
    visible
      .filter(
        (record) =>
          canView(account.viewer, placementOf(record)) &&
          (record.spaceKind === 'personal' ||
            account.viewer.memberships.get(record.spaceId) === 'admin'),
      )
      .map((record) => card(tx, record, true)),
  );
}

export async function notesRoutes(app: FastifyInstance, module: AuthModule) {
  const currentAccount = createAccountReader(module);
  // Текст Drizzle содержит параметры запроса: в журнал отправляются только классификация и SQLSTATE.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ code: error.code });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    if (status === 400 || status === 413) return reply.code(status).send({ code: 'INVALID_INPUT' });
    const { code } = pgError(error);
    if (code === '42501') return reply.code(403).send({ code: 'ACCESS_DENIED' });
    if (['23503', '23505', '23514', '40P01', '40001'].includes(code ?? ''))
      return reply.code(409).send({ code: 'CONFLICT' });
    request.log.error(
      { databaseCode: /^[A-Z0-9]{5}$/.test(code ?? '') ? code : undefined },
      'Notes request failed',
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });

  app.get('/api/notes', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const query = parse(ListNotes, request.query);
    return module.appDb.withAccount(account.id, async (tx) => {
      const rows = await tx
        .select()
        .from(notes)
        .where(
          and(
            query.trash === 'true' ? sql`${notes.deletedAt} IS NOT NULL` : isNull(notes.deletedAt),
            query.scope === 'all' ? undefined : eq(notes.spaceKind, query.scope),
            query.spaceId ? eq(notes.spaceId, query.spaceId) : undefined,
          ),
        )
        .orderBy(desc(notes.pinned), desc(notes.updatedAt), notes.id)
        .limit(query.limit)
        .offset(query.offset);
      return rows.filter((record) => canView(account.viewer, placementOf(record))).map(summary);
    });
  });
  app.get<{ Params: { id: string } }>('/api/notes/:id', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { id } = parse(Id, request.params);
    return module.appDb.withAccount(account.id, async (tx) =>
      card(tx, await get(tx, account, id, false)),
    );
  });
  app.post('/api/notes', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const body = parse(CreateNote, request.body);
    const result = await module.appDb.withAccount(account.id, async (tx) => {
      let placement = await personal(tx, account);
      if (body.placement) {
        const [space] = await tx.select().from(spaces).where(eq(spaces.id, body.placement.spaceId));
        if (!space) throw new Failure(404, 'SPACE_NOT_FOUND');
        if (space.kind === 'personal' && body.placement.audience)
          throw new Failure(400, 'INVALID_INPUT');
        placement =
          space.kind === 'personal'
            ? { kind: 'personal', spaceId: space.id, ownerId: space.ownerAccountId ?? '' }
            : {
                kind: 'household',
                spaceId: space.id,
                audience: body.placement.audience ?? 'household',
              };
      }
      if (body.object) {
        const [object] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, body.object.id))
          .for('update');
        if (!object || object.deletedAt !== null || !canView(account.viewer, placementOf(object)))
          throw new Failure(404, 'OBJECT_NOT_FOUND');
        const parent = placementOf(object);
        if (
          body.placement &&
          (placement.spaceId !== parent.spaceId ||
            (parent.kind === 'household' &&
              parent.audience === 'adults' &&
              placement.kind === 'household' &&
              placement.audience !== 'adults'))
        )
          denied();
        if (!body.placement) placement = parent;
      }
      if (!canCreate(account.viewer, { type: 'note', placement, authorId: account.id })) denied();
      const [record] = await tx
        .insert(notes)
        .values({
          ...columnsOf(placement),
          authorId: account.id,
          title: body.title,
          body: body.body,
          pinned: body.pinned,
        })
        .returning();
      if (!record) throw new Error('Note insert returned no row');
      await replaceItems(tx, account, record, body.checklist);
      return card(tx, record);
    });
    return reply.code(201).send(result);
  });
  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { id } = parse(Id, request.params);
    const body = parse(PatchNote, request.body);
    return module.appDb.withAccount(account.id, async (tx) => {
      const record = await get(tx, account, id);
      if (!canWrite(account.viewer, factsOf(record))) denied();
      if (
        body.expectedUpdatedAt &&
        new Date(body.expectedUpdatedAt).getTime() !== record.updatedAt.getTime()
      )
        throw new Failure(409, 'STALE_VERSION');
      const { checklist, expectedUpdatedAt: _version, ...fields } = body;
      const [updated] = await tx
        .update(notes)
        .set({ ...fields, body: fields.body ?? record.body })
        .where(eq(notes.id, id))
        .returning();
      if (!updated) denied();
      if (checklist) await replaceItems(tx, account, record, checklist);
      return card(tx, updated ?? record);
    });
  });

  async function target(
    tx: Transaction,
    account: Account,
    record: Note,
    action: z.infer<typeof Preview>,
  ) {
    const place =
      action.action === 'personal'
        ? await personal(tx, account)
        : { ...placementOf(record), audience: action.audience };
    const facts = factsOf(record);
    const allowed =
      action.action === 'personal'
        ? canMove(account.viewer, facts, place, await hasContributions(tx, record))
        : canChangeAudience(account.viewer, facts, place);
    if (!allowed) denied();
    if (place.kind === 'household' && place.audience === 'adults') {
      const responsible = [
        record.assigneeId,
        ...(await itemsOf(tx, record.id)).map((item) => item.assigneeId),
      ];
      const adults = await module.db
        .select({ id: spaceMembers.accountId })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, place.spaceId),
            isNull(spaceMembers.leftAt),
            sql`${spaceMembers.role} IN ('admin', 'adult')`,
          ),
        );
      const eligible = new Set(adults.map((member) => member.id));
      if (responsible.some((id) => id !== null && !eligible.has(id)))
        throw new Failure(409, 'ASSIGNEE_CANNOT_SEE');
    }
    return place;
  }
  async function lostAccess(record: Note, place: Placement) {
    const old = placementOf(record);
    if (old.kind !== 'household') return [];
    // Только публичные имена и состав уже доступного дома; таблиц записей у homecrm_auth нет.
    const members = await module.db
      .select({ id: accounts.id, displayName: accounts.displayName, role: spaceMembers.role })
      .from(spaceMembers)
      .innerJoin(accounts, eq(accounts.id, spaceMembers.accountId))
      .where(and(eq(spaceMembers.spaceId, old.spaceId), isNull(spaceMembers.leftAt)));
    return members
      .filter((member) => {
        const viewer = { accountId: member.id, memberships: new Map([[old.spaceId, member.role]]) };
        return canView(viewer, old) && !canView(viewer, place);
      })
      .map(({ id, displayName }) => ({ accountId: id, displayName }));
  }
  app.post<{ Params: { id: string } }>('/api/notes/:id/access-preview', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { id } = parse(Id, request.params);
    const action = parse(Preview, request.body);
    return module.appDb.withAccount(account.id, async (tx) => {
      const record = await get(tx, account, id);
      const place = await target(tx, account, record, action);
      return { updatedAt: record.updatedAt, losesAccess: await lostAccess(record, place) };
    });
  });
  for (const action of ['share', 'personal', 'copy', 'audience', 'trash', 'restore'] as const) {
    app.post<{ Params: { id: string } }>(`/api/notes/:id/${action}`, async (request, reply) => {
      const account = await currentAccount(request, reply);
      if (!account) return reply;
      const { id } = parse(Id, request.params);
      const result = await module.appDb.withAccount(account.id, async (tx) => {
        const record = await get(tx, account, id, action !== 'copy');
        const facts = factsOf(record);
        if (action === 'copy') {
          parse(Confirm.partial(), request.body ?? {});
          if (!canCopyToPersonal(account.viewer, facts)) denied();
          const place = await personal(tx, account);
          const [copy] = await tx
            .insert(notes)
            .values({
              ...columnsOf(place),
              authorId: account.id,
              title: record.title,
              body: record.body,
              pinned: record.pinned,
            })
            .returning();
          if (!copy) throw new Error('Copy returned no row');
          const items = (await itemsOf(tx, id)).filter((item) => item.deletedAt === null);
          await replaceItems(
            tx,
            account,
            copy,
            items.map(({ title, done }) => ({ title, done })),
          );
          return card(tx, copy);
        }
        let fields: Partial<typeof notes.$inferInsert>;
        if (action === 'share') {
          const body = parse(ShareNote, request.body);
          const place: Placement = {
            kind: 'household',
            spaceId: body.spaceId,
            audience: body.audience,
          };
          if (!canMove(account.viewer, facts, place, await hasContributions(tx, record))) denied();
          fields = columnsOf(place);
        } else if (action === 'personal' || action === 'audience') {
          const body =
            action === 'personal'
              ? parse(Confirm, request.body)
              : parse(AudienceChange, request.body);
          const place = await target(
            tx,
            account,
            record,
            action === 'personal'
              ? { action }
              : { action, audience: (body as z.infer<typeof AudienceChange>).audience },
          );
          if (
            (action === 'personal' ||
              (place.kind === 'household' &&
                place.audience === 'adults' &&
                record.audience !== 'adults')) &&
            !body.confirmed
          )
            throw new Failure(409, 'CONFIRMATION_REQUIRED');
          fields = columnsOf(place);
        } else {
          parse(Confirm.partial(), request.body ?? {});
          if (
            action === 'trash'
              ? !canTrash(account.viewer, facts)
              : !canRestore(account.viewer, facts)
          )
            denied();
          fields = { deletedAt: action === 'trash' ? new Date() : null };
        }
        const [updated] = await tx.update(notes).set(fields).where(eq(notes.id, id)).returning();
        if (!updated) denied();
        return card(tx, updated ?? record);
      });
      return reply.code(action === 'copy' ? 201 : 200).send(result);
    });
  }
}
