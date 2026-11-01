import {
  and,
  desc,
  eq,
  inboxFiles,
  inboxItems,
  isNull,
  meters,
  objects,
  recordLinks,
  spaces,
  sql,
  type Transaction,
} from '@homecrm/db';
import {
  canCreate,
  canViewInbox,
  INBOX_MAX_BYTES,
  InboxCapture,
  InboxDraft,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AiConfig } from '../ai/config.ts';
import { aiProvider } from '../ai/config.ts';
import { type Account, createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { prepareFile, safeFilename } from '../files/media.ts';
import {
  discardAfterCommit,
  type FileServices,
  fileSummary,
  filesOf,
  insertPreparedFile,
  prepareUpload,
} from '../files/service.ts';
import { fingerprint } from '../idempotency.ts';
import { CreateObject } from '../objects/schemas.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  Failure,
  factsOf,
  missing,
  parse,
  placementFrom,
  readReference,
  requireWrite,
} from '../objects/support.ts';
import { validateProperty } from '../utilities/service.ts';
import { processInbox } from './processing.ts';

const Id = z.strictObject({ id: z.uuid() });
const Target = z.strictObject({
  type: z.enum([
    'task',
    'note',
    'document',
    'object',
    'shopping_item',
    'meter_reading',
    'utility_charge',
  ]),
  id: z.uuid(),
});
export async function inboxRoutes(
  app: FastifyInstance,
  options: AuthModule & { files?: FileServices; ai: AiConfig },
) {
  const route = dataRoutes(app, options);
  const currentAccount = createAccountReader(options);
  let active = 0;
  app.post('/api/inbox/:id/parse', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { id } = parse(Id, request.params);
    const input = parse(z.strictObject({ consent: z.string().max(200).optional() }), request.body);
    await options.appDb.withAccount(account.id, async (tx) => {
      const row = await item(tx, account, id);
      if (row.deletedAt || row.resolvedAt) missing();
      if (input.consent) {
        if (input.consent !== `v4:${aiProvider(options.ai)}`)
          throw new Failure(409, 'AI_CONSENT_REQUIRED');
        await tx
          .update(inboxItems)
          .set({
            consent: input.consent,
            ...(row.status === 'error' ? { status: 'new', errorCode: null } : {}),
          })
          .where(eq(inboxItems.id, id));
      }
    });
    if (active >= 2) throw new Failure(429, 'AI_BUSY');
    active++;
    try {
      await processInbox(options.appDb, options.files, options.ai, id, account.id, app.log);
      return { ok: true };
    } finally {
      active--;
    }
  });
  route('GET', '/api/inbox/meters', 200, async (tx) =>
    tx
      .select({
        id: meters.id,
        title: meters.title,
        objectId: objects.id,
        objectTitle: objects.title,
      })
      .from(meters)
      .innerJoin(objects, eq(meters.parentId, objects.id))
      .where(and(isNull(meters.deletedAt), isNull(objects.deletedAt))),
  );
  async function item(tx: Transaction, account: Account, id: string) {
    const [row] = await tx.select().from(inboxItems).where(eq(inboxItems.id, id)).for('update');
    if (!row || !canViewInbox(account.viewer, factsOf(row, 'inbox_item'))) missing();
    return row;
  }
  route('GET', '/api/inbox', 200, async (tx, _account, request) => {
    const { deleted } = parse(
      z.strictObject({ deleted: z.literal('1').optional() }),
      request.query,
    );
    const rows = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          isNull(inboxItems.resolvedAt),
          deleted ? sql`${inboxItems.deletedAt} IS NOT NULL` : isNull(inboxItems.deletedAt),
        ),
      )
      .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id));
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        captureHash: undefined,
        files: (await filesOf(tx, 'inbox_item', row.id))
          .filter((f) => !f.deletedAt || deleted)
          .map(fileSummary),
      })),
    );
  });
  // Все страницы и текст фиксируются одной транзакцией существующей офлайн-очереди.
  app.addHook('onRoute', (r) => {
    if (r.url === '/api/inbox' && r.method === 'POST') r.bodyLimit = 15 * 1024 * 1024;
  });
  route('POST', '/api/inbox', 201, async (tx, account, request) => {
    const input = parse(
      InboxCapture.extend({
        ownerAccountId: z.uuid(),
        offline: z.literal(true),
        idempotencyKey: z.uuid(),
        clientActedAt: z.iso.datetime().optional(),
      }),
      request.body,
    );
    if (input.ownerAccountId !== account.id || input.id !== input.idempotencyKey)
      throw new Failure(403, 'ACCOUNT_MISMATCH');
    const {
      ownerAccountId: _owner,
      offline: _offline,
      idempotencyKey: _key,
      clientActedAt: _acted,
      ...capture
    } = input;
    const hash = fingerprint(capture);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox:${account.id}:${input.id}`},0))`,
    );
    const [known] = await tx.select().from(inboxItems).where(eq(inboxItems.id, input.id));
    if (known && known.captureHash !== hash) throw new Failure(409, 'IDEMPOTENCY_CONFLICT');
    const receipt = (row: typeof inboxItems.$inferSelect) => ({
      id: row.id,
      receipt: {
        ownerAccountId: account.id,
        key: input.id,
        operation: 'inbox_create',
        confirmedAt: row.createdAt.toISOString(),
        results: [{ id: row.id, updatedAt: row.createdAt.toISOString() }],
      },
    });
    if (known) return receipt(known);
    const decoded = input.files.map((file) => {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
        throw new Failure(400, 'INVALID_INPUT');
      return { ...file, bytes: Buffer.from(file.base64, 'base64') };
    });
    if (!input.text.trim() && !decoded.length) throw new Failure(400, 'INVALID_INPUT');
    if (
      Buffer.byteLength(input.text) + decoded.reduce((sum, f) => sum + f.bytes.length, 0) >
      INBOX_MAX_BYTES
    )
      throw new Failure(413, 'FILE_TOO_LARGE');
    if (decoded.length && !options.files) throw new Failure(503, 'FILES_UNAVAILABLE');
    const [personal] = await tx.select().from(spaces).where(eq(spaces.ownerAccountId, account.id));
    if (!personal) missing();
    if (input.houseId && !account.viewer.memberships.has(input.houseId))
      throw new Failure(403, 'ACCESS_DENIED');
    const prepared = await Promise.all(
      decoded.map(async (f) =>
        prepareUpload(options.files as FileServices, {
          ...(await prepareFile(f.bytes)),
          name: safeFilename(f.name),
        }),
      ),
    );
    if (
      Buffer.byteLength(input.text) + prepared.reduce((sum, file) => sum + file.sizeBytes, 0) >
      INBOX_MAX_BYTES
    )
      throw new Failure(413, 'FILE_TOO_LARGE');
    const [row] = await tx
      .insert(inboxItems)
      .values({
        id: input.id,
        title: 'Входящее',
        authorId: account.id,
        spaceId: personal.id,
        spaceKind: 'personal',
        source: input.source,
        text: input.text,
        houseId: input.houseId,
        consent: input.consent,
        captureHash: hash,
      })
      .returning();
    if (!row) missing();
    for (const file of prepared) await insertPreparedFile(tx, account, 'inbox_item', row, file);
    return receipt(row);
  });
  for (const action of ['trash', 'restore'] as const)
    route('POST', `/api/inbox/:id/${action}`, 200, async (tx, account, request) => {
      const row = await item(tx, account, parse(Id, request.params).id);
      await tx
        .update(inboxItems)
        .set({
          deletedAt: action === 'trash' ? new Date() : null,
        })
        .where(eq(inboxItems.id, row.id));
      if (action === 'restore')
        await tx
          .update(inboxItems)
          .set({ restoredAt: new Date() })
          .where(eq(inboxItems.id, row.id));
      return { ok: true };
    });
  route('POST', '/api/inbox/:id/resolve', 200, async (tx, account, request) => {
    const input = parse(
      z.union([
        Target.extend({ attachSource: z.boolean().default(true) }),
        z.strictObject({
          targets: z.array(Target).min(1).max(200),
          attachSource: z.boolean().default(true),
        }),
      ]),
      request.body,
    );
    const targets = 'targets' in input ? input.targets : [{ type: input.type, id: input.id }];
    const body = targets.find((target) => target.type !== 'shopping_item') ?? targets[0];
    if (!body) missing();
    const resolution = {
      ...body,
      ...(targets.length > 1 ? { additional: targets.filter((target) => target !== body) } : {}),
    };
    const row = await item(tx, account, parse(Id, request.params).id);
    if (row.resolvedAt) {
      const signature = (items: { type: string; id: string }[]) =>
        items
          .map((item) => `${item.type}:${item.id}`)
          .sort()
          .join(';');
      if (
        !row.target ||
        signature([row.target, ...(row.target.additional ?? [])]) !== signature(targets)
      )
        throw new Failure(409, 'ALREADY_RESOLVED');
      return {
        ok: true,
        attachedTo: input.attachSource && body.type !== 'shopping_item' ? [body.type] : [],
      };
    }
    if (row.deletedAt) missing();
    for (const target of targets) {
      const ref = await readReference(tx, account, target);
      requireWrite(account, ref.row, target.type);
      if (ref.row.deletedAt) missing();
    }
    const target = await readReference(tx, account, body);
    requireWrite(account, target.row, body.type);
    if (target.row.deletedAt) missing();
    const files = (await filesOf(tx, 'inbox_item', row.id)).filter((f) => !f.deletedAt);
    const parentType =
      body.type === 'shopping_item'
        ? 'note'
        : body.type === 'meter_reading' || body.type === 'utility_charge'
          ? 'object'
          : body.type;
    let parent = target.row;
    if (body.type === 'meter_reading' || body.type === 'utility_charge') {
      const result = await tx.execute<{ object_id: string }>(
        body.type === 'meter_reading'
          ? sql`SELECT m.parent_id AS object_id FROM meter_readings r JOIN meters m ON m.id=r.parent_id WHERE r.id=${body.id}::uuid`
          : sql`SELECT a.parent_id AS object_id FROM utility_charges c JOIN utility_accounts a ON a.id=c.parent_id WHERE c.id=${body.id}::uuid`,
      );
      const id = result.rows[0]?.object_id;
      if (!id) missing();
      parent = (await readReference(tx, account, { type: 'object', id })).row;
      requireWrite(account, parent);
      if (
        input.attachSource &&
        files.length &&
        (parent.spaceId !== target.row.spaceId || parent.audience !== target.row.audience)
      )
        throw new Failure(409, 'FILE_PLACEMENT_MISMATCH');
    }
    // Новый объект отмечен сервером; существующий общий объект не получает личный файл.
    const destinations: (typeof parent)[] = [];
    if (input.attachSource && row.target?.type === 'object' && row.target.id !== parent.id) {
      const object = await readReference(tx, account, { type: 'object', id: row.target.id });
      if (object.row.deletedAt) missing();
      requireWrite(account, object.row);
      if (object.row.spaceId === target.row.spaceId && object.row.audience === target.row.audience)
        destinations.push(object.row);
    }
    const moved: string[] = [];
    for (const f of !input.attachSource || body.type === 'shopping_item' ? [] : files) {
      if (!options.files) throw new Failure(503, 'FILES_UNAVAILABLE');
      const bytes = options.files.cipher.open(
        await options.files.storage.get(f.storageKey),
        f.envelope,
        f.storageKey,
      );
      const copy = await insertPreparedFile(
        tx,
        account,
        parentType,
        parent,
        prepareUpload(options.files, {
          data: bytes,
          mimeType: f.mimeType,
          name: f.title,
          ...(f.previewStorageKey
            ? {
                preview: options.files.cipher.open(
                  await options.files.storage.get(f.previewStorageKey),
                  f.previewEnvelope,
                  f.previewStorageKey,
                ),
              }
            : {}),
        }),
      );
      moved.push(copy.id);
      for (const destination of destinations)
        await insertPreparedFile(
          tx,
          account,
          'object',
          destination,
          prepareUpload(options.files, { data: bytes, mimeType: f.mimeType, name: f.title }),
        );
    }
    if (body.type === 'meter_reading' || body.type === 'utility_charge') {
      if (body.type === 'meter_reading' && moved.length > 10)
        throw new Failure(409, 'TOO_MANY_PHOTOS');
      for (const id of moved)
        await tx.insert(recordLinks).values({
          leftTable: body.type === 'meter_reading' ? 'meter_readings' : 'utility_charges',
          leftId: body.id,
          rightTable: 'object_files',
          rightId: id,
          role: body.type === 'meter_reading' ? 'reading_photo' : 'receipt',
          authorId: account.id,
        });
    }
    await tx
      .update(inboxItems)
      .set({
        resolvedAt: new Date(),
        target: resolution,
        deletedAt: new Date(),
        text: '',
        draft: null,
      })
      .where(eq(inboxItems.id, row.id));
    await tx.delete(inboxFiles).where(eq(inboxFiles.parentId, row.id));
    if (files.length)
      discardAfterCommit(
        tx,
        files.flatMap((file) => [
          file.storageKey,
          ...(file.previewStorageKey ? [file.previewStorageKey] : []),
        ]),
      );
    const attachedTo = moved.length ? [body.type, ...(destinations.length ? ['object'] : [])] : [];
    return { ok: true, attachedTo };
  });
  route('POST', '/api/inbox/:id/object', 200, async (tx, account, request) => {
    const row = await item(tx, account, parse(Id, request.params).id);
    if (row.deletedAt || row.resolvedAt) missing();
    const input = parse(
      z.union([
        Id,
        z.strictObject({
          create: CreateObject.pick({ title: true, objectType: true, typeData: true }),
        }),
      ]),
      request.body,
    );
    let id: string;
    if ('id' in input) id = input.id;
    else if (row.target?.type === 'object') id = row.target.id;
    else {
      const place = await placementFrom(tx, account);
      if (!canCreate(account.viewer, { type: 'object', placement: place, authorId: account.id }))
        deny();
      if (input.create.typeData && input.create.objectType !== 'property')
        throw new Failure(400, 'INVALID_INPUT');
      const typeData =
        input.create.objectType === 'property'
          ? await validateProperty(tx, account, place, input.create.typeData ?? {})
          : {};
      const [created] = await tx
        .insert(objects)
        .values({
          ...columnsOf(place),
          authorId: account.id,
          title: input.create.title,
          objectType: input.create.objectType,
          typeData,
        })
        .returning();
      if (!created) throw new Error('Object insert returned no row');
      id = created.id;
      await tx
        .update(inboxItems)
        .set({ target: { type: 'object', id } })
        .where(eq(inboxItems.id, row.id));
    }
    const object = await readReference(tx, account, { type: 'object', id });
    if (object.row.deletedAt) missing();
    const draft = parse(InboxDraft, row.draft);
    draft.classification.objectId = { value: id, confident: true };
    draft.classification.newObject = null;
    await tx.update(inboxItems).set({ draft }).where(eq(inboxItems.id, row.id));
    return { ok: true, id };
  });
}
