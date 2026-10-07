import multipart from '@fastify/multipart';
import { eq, notes, objects, sql, type Transaction } from '@homecrm/db';
import { canRestore, canTrash, canViewFile, canWrite } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Account, createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import {
  dataRoutes,
  deny,
  Failure,
  factsOf,
  missing,
  parse,
  readReference,
} from '../objects/support.ts';
import { MAX_FILE_BYTES, prepareFile, safeFilename } from './media.ts';
import {
  type FileRow,
  type FileServices,
  fileSummary,
  filesOf,
  fileTable,
  insertFile,
  type ParentType,
} from './service.ts';

const Id = z.strictObject({ id: z.uuid() });
const ChildId = z.strictObject({ id: z.uuid(), fileId: z.uuid() });
async function parentOf(
  tx: Transaction,
  account: Account,
  type: ParentType,
  id: string,
  lock = false,
) {
  const reference = await readReference(tx, account, { type, id });
  if (!lock) return reference;
  const table = type === 'note' ? notes : objects;
  const [row] = await tx.select().from(table).where(eq(table.id, id)).for('update');
  if (!row) deny();
  return { row, facts: factsOf(row, type) };
}
async function visibleFile(
  tx: Transaction,
  account: Account,
  type: ParentType,
  row: FileRow | undefined,
  parentId?: string,
) {
  if (!row || (parentId && row.parentId !== parentId)) missing();
  const parent = await parentOf(tx, account, type, row.parentId);
  if (
    !canViewFile(
      account.viewer,
      factsOf(row, type === 'note' ? 'note_file' : 'object_file'),
      parent.facts,
    )
  )
    missing();
  return row;
}
export async function filesRoutes(
  app: FastifyInstance,
  options: AuthModule & { files: FileServices },
) {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
    throwFileSizeLimit: true,
  });
  const route = dataRoutes(app, options);
  const currentAccount = createAccountReader(options);
  for (const type of ['note', 'object'] as const) {
    const path = `/api/${type === 'note' ? 'notes' : 'objects'}/:id/files`;
    route('GET', path, 200, async (tx, account, request) => {
      const id = parse(Id, request.params).id;
      const parent = await parentOf(tx, account, type, id);
      return (await filesOf(tx, type, id))
        .filter((row) => parent.row.deletedAt !== null || row.deletedAt === null)
        .map(fileSummary);
    });
    route('POST', path, 201, async (tx, account, request) => {
      const id = parse(Id, request.params).id;
      const parent = await parentOf(tx, account, type, id, true);
      if (!canWrite(account.viewer, parent.facts)) deny();
      if (!request.isMultipart()) throw new Failure(415, 'UNSUPPORTED_FILE');
      let uploaded: { data: Buffer; name: string } | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file') throw new Failure(400, 'INVALID_INPUT');
        uploaded = { data: await part.toBuffer(), name: safeFilename(part.filename) };
      }
      if (!uploaded) throw new Failure(400, 'INVALID_INPUT');
      const prepared = await prepareFile(uploaded.data);
      return fileSummary(
        await insertFile(tx, account, type, parent.row, { ...prepared, name: uploaded.name }),
      );
    });
    for (const action of ['trash', 'restore'] as const)
      route('POST', `${path}/:fileId/${action}`, 200, async (tx, account, request) => {
        const { id, fileId } = parse(ChildId, request.params);
        const table = fileTable(type);
        const [file] = await tx.select().from(table).where(eq(table.id, fileId));
        const row = await visibleFile(tx, account, type, file, id);
        const parent = await parentOf(tx, account, type, id, true);
        if (parent.row.deletedAt !== null) deny();
        // Восстановление дополнительно проверяет RLS (автор или администратор).
        if (
          action === 'trash'
            ? !canTrash(account.viewer, factsOf(row))
            : !canRestore(account.viewer, factsOf(row))
        )
          deny();
        const [updated] = await tx
          .update(table)
          .set({ deletedAt: action === 'trash' ? new Date() : null })
          .where(eq(table.id, fileId))
          .returning();
        if (!updated) deny();
        return fileSummary(updated);
      });
  }
  for (const preview of [false, true])
    app.get(`/api/files/:id${preview ? '/preview' : ''}`, async (request, reply) => {
      const account = await currentAccount(request, reply);
      if (!account) return reply;
      const id = parse(Id, request.params).id;
      const result = await options.appDb.withAccount(account.id, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))`,
        );
        for (const type of ['note', 'object'] as const) {
          const table = fileTable(type);
          const [file] = await tx.select().from(table).where(eq(table.id, id));
          if (!file) continue;
          const row = await visibleFile(tx, account, type, file);
          const key = preview ? row.previewStorageKey : row.storageKey;
          if (!key) missing();
          const data = options.files.cipher.open(
            await options.files.storage.get(key),
            preview ? row.previewEnvelope : row.envelope,
            key,
          );
          return {
            data,
            mimeType: preview ? 'image/webp' : row.mimeType,
            name: preview ? 'preview.webp' : safeFilename(row.title),
          };
        }
        missing();
      });
      const name = encodeURIComponent(result.name).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16)}`,
      );
      reply.header(
        'Content-Disposition',
        `${preview ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${name}`,
      );
      return reply.type(result.mimeType).send(result.data);
    });
}
