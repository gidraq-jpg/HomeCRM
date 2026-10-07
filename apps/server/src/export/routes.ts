import { createReadStream } from 'node:fs';
import { sql } from '@homecrm/db';
import {
  canExportHouse,
  canExportPersonal,
  ExportHistoryItem,
  ExportRequest,
} from '@homecrm/shared';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import { createAccountReader } from '../auth/account.ts';
import { clearFailures, reserveAttempt } from '../auth/attempts.ts';
import { pgError } from '../auth/provision.ts';
import { reserveSessionRequest } from '../auth/rate-limit.ts';
import type { AuthModule } from '../auth/routes.ts';
import type { FileServices } from '../files/service.ts';
import { buildArchive } from './archive.ts';

export async function exportRoutes(
  app: FastifyInstance,
  module: AuthModule & { files?: FileServices },
) {
  const currentAccount = createAccountReader(module);
  app.get('/api/export/history', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    return module.appDb.withAccount(account.id, async (tx) =>
      (
        await tx.execute<{ data: unknown }>(
          sql`SELECT to_jsonb(e) || jsonb_build_object('actor_name',m.display_name) AS data FROM export_events e
            LEFT JOIN space_members m ON m.space_id=e.household_id AND m.account_id=e.account_id
            ORDER BY e.created_at DESC,e.id DESC LIMIT 50`,
        )
      ).rows.map(({ data }) => ExportHistoryItem.parse(data)),
    );
  });
  app.post('/api/export/archive', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const parsed = ExportRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    const { scope, password } = parsed.data;
    if (
      scope.kind === 'household'
        ? !canExportHouse(account.viewer, scope.householdId)
        : !canExportPersonal(account.viewer, account.id)
    )
      return reply.code(403).send({ code: 'ACCESS_DENIED' });
    const retryAfter = await reserveSessionRequest(module.db, `export:${request.ip}:${account.id}`);
    if (retryAfter !== null)
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ code: 'TOO_MANY_REQUESTS' });
    const attempt = await reserveAttempt(module.db, { accountId: account.id });
    if (!attempt.allowed)
      return reply
        .header(
          'retry-after',
          String(Math.max(1, Math.ceil((attempt.lockedUntil.getTime() - Date.now()) / 1000))),
        )
        .code(429)
        .send({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    try {
      // verifyPassword в установленной Better Auth использует sensitiveSessionMiddleware.
      await module.auth.api.verifyPassword({
        headers: fromNodeHeaders(request.headers),
        body: { password },
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
      return reply.code(error.statusCode === 401 ? 401 : 403).send({ code: 'INVALID_PASSWORD' });
    }
    await clearFailures(module.db, { accountId: account.id });
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    let archive: Awaited<ReturnType<typeof buildArchive>> | undefined;
    try {
      archive = await module.appDb.withAccount(
        account.id,
        async (tx) => {
          const built = await buildArchive(
            tx,
            account,
            scope,
            module.files,
            module.homeTimeZone,
            controller.signal,
          );
          // Ошибка отметки отменяет выдачу; архив удаляется и при отказе COMMIT.
          archive = built;
          await tx.execute(sql`INSERT INTO export_events(account_id,kind,household_id,counts,size_bytes)
            VALUES (${account.id}::uuid,${scope.kind},${scope.kind === 'household' ? scope.householdId : null}::uuid,${JSON.stringify(built.manifest.counts)}::jsonb,${built.size})`);
          return built;
        },
        { isolationLevel: 'repeatable read' },
      );
      controller.signal.throwIfAborted();
      const completed = archive;
      const cleanup = () => {
        void completed.cleanup().catch(() => app.log.error('Failed to remove temporary export'));
      };
      reply.raw.once('close', cleanup);
      const stream = createReadStream(archive.path);
      stream.once('close', cleanup);
      app.log.info(
        { kind: scope.kind, counts: archive.manifest.counts, size: archive.size },
        'Export prepared',
      );
      return reply
        .type('application/zip')
        .header('content-disposition', `attachment; filename="homecrm-${scope.kind}.zip"`)
        .header('x-content-type-options', 'nosniff')
        .header('content-length', archive.size)
        .send(stream);
    } catch (error) {
      if (archive) await archive.cleanup();
      app.log.error({ code: pgError(error).code ?? 'EXPORT_FAILED' }, 'Export failed');
      return reply.code(500).send({ code: 'EXPORT_FAILED' });
    }
  });
}
