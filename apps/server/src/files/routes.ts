import multipart from '@fastify/multipart';
import {
  documents,
  eq,
  notes,
  objects,
  profileFiles,
  sql,
  type Transaction,
  tasks,
} from '@homecrm/db';
import { canRestore, canTrash, canViewFile, canWrite, canWriteProfileFile } from '@homecrm/shared';
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
import { visibleProfilePhoto } from './export.ts';
import { MAX_FILE_BYTES, prepareFile, safeFilename } from './media.ts';
import {
  type FileRow,
  type FileServices,
  fileSummary,
  filesOf,
  fileTable,
  insertPreparedFile,
  insertProfileFile,
  lockProfile,
  type ParentType,
  prepareUpload,
  setProfilePhoto,
} from './service.ts';

const Id = z.strictObject({ id: z.uuid() });
const ChildId = z.strictObject({ id: z.uuid(), fileId: z.uuid() });
const Deleted = z.strictObject({ deleted: z.literal('1').optional() });
const Inline = z.strictObject({ inline: z.literal('1').optional() });
async function parentOf(
  tx: Transaction,
  account: Account,
  type: ParentType,
  id: string,
  lock = false,
) {
  const reference = await readReference(tx, account, { type, id });
  if (!lock) return reference;
  const table =
    type === 'task' ? tasks : type === 'note' ? notes : type === 'document' ? documents : objects;
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
      factsOf(
        row,
        type === 'task'
          ? 'task_file'
          : type === 'note'
            ? 'note_file'
            : type === 'document'
              ? 'document_file'
              : 'object_file',
      ),
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
  async function receive(request: import('fastify').FastifyRequest) {
    if (!request.isMultipart()) throw new Failure(415, 'UNSUPPORTED_FILE');
    let uploaded: { data: Buffer; name: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') throw new Failure(400, 'INVALID_INPUT');
      uploaded = { data: await part.toBuffer(), name: safeFilename(part.filename) };
    }
    if (!uploaded) throw new Failure(400, 'INVALID_INPUT');
    return { ...(await prepareFile(uploaded.data)), name: uploaded.name };
  }
  app.post('/api/me/profile/photo', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const prepared = await receive(request);
    if (!prepared.mimeType.startsWith('image/')) throw new Failure(415, 'UNSUPPORTED_FILE');
    const sealed = prepareUpload(options.files, prepared);
    const row = await options.appDb.withAccount(account.id, async (tx) => {
      await lockProfile(tx, account);
      const file = await insertProfileFile(tx, account, sealed);
      await setProfilePhoto(tx, account, file.id);
      return file;
    });
    return reply.code(201).send(fileSummary(row));
  });
  route('DELETE', '/api/me/profile/photo', 200, (tx, account) =>
    setProfilePhoto(tx, account, null),
  );
  route('POST', '/api/me/profile/photo/:id/restore', 200, async (tx, account, request) => {
    const id = parse(Id, request.params).id;
    await lockProfile(tx, account);
    const [file] = await tx.select().from(profileFiles).where(eq(profileFiles.id, id));
    if (!file) missing();
    if (!canWriteProfileFile(account.viewer, file.accountId)) deny();
    const [restored] = await tx
      .update(profileFiles)
      .set({ deletedAt: null })
      .where(eq(profileFiles.id, id))
      .returning();
    if (!restored) deny();
    await setProfilePhoto(tx, account, id);
    return fileSummary(restored);
  });
  route('GET', '/api/files/trash', 200, async (tx, account) => {
    const result = [];
    for (const type of ['note', 'object', 'document', 'task'] as const) {
      const table = fileTable(type);
      const parentTable =
        type === 'task'
          ? tasks
          : type === 'note'
            ? notes
            : type === 'document'
              ? documents
              : objects;
      const rows = await tx
        .select({ file: table, parent: parentTable })
        .from(table)
        .innerJoin(parentTable, eq(table.parentId, parentTable.id))
        .where(sql`${table.deletedAt} IS NOT NULL AND ${parentTable.deletedAt} IS NULL`)
        .orderBy(table.deletedAt, table.id);
      for (const { file, parent } of rows) {
        const canRestoreFile = canRestore(account.viewer, factsOf(file));
        if (!canViewFile(account.viewer, factsOf(file), factsOf(parent))) continue;
        result.push({
          ...fileSummary(file),
          parentType: type,
          parentId: parent.id,
          canRestore: canRestoreFile,
        });
      }
    }
    for (const file of await tx
      .select()
      .from(profileFiles)
      .where(sql`${profileFiles.deletedAt} IS NOT NULL`)
      .orderBy(profileFiles.deletedAt, profileFiles.id)) {
      if (!canWriteProfileFile(account.viewer, file.accountId)) continue;
      result.push({
        ...fileSummary(file),
        parentType: 'profile',
        parentId: file.accountId,
        canRestore: true,
      });
    }
    return result;
  });
  for (const type of ['note', 'object', 'document', 'task'] as const) {
    const path = `/api/${type === 'task' ? 'tasks' : type === 'note' ? 'notes' : type === 'document' ? 'documents' : 'objects'}/:id/files`;
    route('GET', path, 200, async (tx, account, request) => {
      const id = parse(Id, request.params).id;
      const deleted = parse(Deleted, request.query).deleted === '1';
      const parent = await parentOf(tx, account, type, id);
      return (await filesOf(tx, type, id))
        .filter((row) =>
          deleted
            ? parent.row.deletedAt === null && row.deletedAt !== null
            : parent.row.deletedAt !== null || row.deletedAt === null,
        )
        .map((row) => ({
          ...fileSummary(row),
          canRestore:
            parent.row.deletedAt === null &&
            row.deletedAt !== null &&
            canRestore(account.viewer, factsOf(row)),
        }));
    });
    app.post(path, async (request, reply) => {
      const account = await currentAccount(request, reply);
      if (!account) return reply;
      const id = parse(Id, request.params).id;
      // Короткая предварительная проверка; приём и обработка файла не держат соединение.
      await options.appDb.withAccount(account.id, async (tx) => {
        const parent = await parentOf(tx, account, type, id);
        if (!canWrite(account.viewer, parent.facts)) deny();
      });
      const sealed = prepareUpload(options.files, await receive(request));
      const row = await options.appDb.withAccount(account.id, async (tx) => {
        // Повторяем права после ожидания: родитель мог попасть в корзину или сменить доступ.
        const parent = await parentOf(tx, account, type, id, true);
        if (!canWrite(account.viewer, parent.facts)) deny();
        return insertPreparedFile(tx, account, type, parent.row, sealed);
      });
      return reply.code(201).send(fileSummary(row));
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
      const inline = parse(Inline, request.query).inline === '1';
      const result = await options.appDb.withAccount(account.id, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))`,
        );
        for (const type of ['note', 'object', 'document', 'task'] as const) {
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
        const [file] = await tx.select().from(profileFiles).where(eq(profileFiles.id, id));
        if (file && (await visibleProfilePhoto(tx, account, file))) {
          const key = preview ? file.previewStorageKey : file.storageKey;
          if (!key) missing();
          return {
            data: options.files.cipher.open(
              await options.files.storage.get(key),
              preview ? file.previewEnvelope : file.envelope,
              key,
            ),
            mimeType: preview ? 'image/webp' : file.mimeType,
            name: preview ? 'preview.webp' : safeFilename(file.title),
          };
        }
        missing();
      });
      const name = encodeURIComponent(result.name).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16)}`,
      );
      const inlinePdf = !preview && inline && result.mimeType === 'application/pdf';
      if (inlinePdf) reply.header('Content-Security-Policy', 'sandbox');
      reply.header(
        'Content-Disposition',
        `${preview || inlinePdf ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${name}`,
      );
      return reply.type(result.mimeType).send(result.data);
    });
}
