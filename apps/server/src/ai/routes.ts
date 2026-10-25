import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import {
  and,
  desc,
  eq,
  isNull,
  objects,
  recordLinks,
  spaceMembers,
  spaces,
  sql,
} from '@homecrm/db';
import { AiStatus, canView, canViewMembership, ExtractInput } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { Failure, factsOf, parse } from '../objects/support.ts';
import type { AiConfig } from './config.ts';
import { createProviders, validateAudio } from './providers.ts';

const House = z.strictObject({ spaceId: z.uuid() });
export async function aiRoutes(app: FastifyInstance, options: AuthModule & { ai: AiConfig }) {
  const { ai } = options;
  const providers = createProviders(ai);
  app.addHook('onClose', () => providers.close());
  let active = 0;
  let health: { expires: number; result: Promise<boolean[]> } | undefined;
  function providerHealth() {
    if (!health || health.expires <= Date.now())
      health = {
        expires: Date.now() + 30000,
        result: Promise.all([providers.speech.health(), providers.extractor.health()]),
      };
    return health.result;
  }
  app.addHook('onRoute', (route) => {
    if (route.method !== 'POST') return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      if (active >= 2) throw new Failure(429, 'AI_BUSY');
      active++;
      try {
        return await handler.call(this, request, reply);
      } finally {
        active--;
      }
    };
  });
  const accountReader = createAccountReader(options);
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const failure =
      error instanceof Failure
        ? error
        : status === 413
          ? new Failure(413, 'AI_INVALID_AUDIO', 'Звук должен быть не больше 10 МБ.')
          : status === 400 || status === 415
            ? new Failure(400, 'INVALID_INPUT', 'Проверьте формат запроса.')
            : new Failure(503, 'AI_UNAVAILABLE');
    request.log.info({ operation: 'ai', code: failure.code }, 'AI request failed');
    return reply.code(failure.status).send({
      code: failure.code,
      message: failure.publicMessage ?? 'Служба ИИ недоступна. Можно ввести вручную.',
    });
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  async function house(accountId: string, id: string) {
    return options.appDb.withAccount(accountId, async (tx) => {
      const [row] = await tx
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, id), eq(spaces.kind, 'household')));
      if (!row) throw new Failure(404, 'NOT_FOUND');
      const usage = await tx.execute<{ remaining: number }>(
        sql`SELECT app.ai_remaining(${id}::uuid,${ai.AI_DAILY_LIMIT}::integer) AS remaining`,
      );
      return { row, remaining: usage.rows[0]?.remaining ?? 0 };
    });
  }
  app.get('/api/ai/status', async (request, reply) => {
    const account = await accountReader(request, reply);
    if (!account) return reply;
    const { spaceId } = parse(House, request.query);
    const { row, remaining } = await house(account.id, spaceId);
    const [speech, extraction] = row.aiEnabled ? await providerHealth() : [false, false];
    const supplier =
      ai.AI_EXTRACT_MODEL === 'hermes-agent' ? 'Hermes → OpenAI' : 'Совместимый поставщик';
    const version = createHash('sha256')
      .update(JSON.stringify([ai.AI_EXTRACT_PROVIDER, ai.AI_EXTRACT_URL, ai.AI_EXTRACT_MODEL]))
      .digest('hex')
      .slice(0, 16);
    return AiStatus.parse({
      enabled: row.aiEnabled,
      speech,
      extraction,
      remaining,
      provider: `${ai.AI_EXTRACT_PROVIDER === 'fake' ? 'Учебный поставщик' : supplier}:${version}`,
    });
  });
  app.patch('/api/ai/settings', async (request, reply) => {
    const account = await accountReader(request, reply);
    if (!account) return reply;
    const body = parse(House.extend({ enabled: z.boolean() }), request.body);
    const changed = await options.appDb.withAccount(account.id, async (tx) => {
      // RLS перепроверяет роль при UPDATE: устаревшая сессия не даёт прав администратора.
      if (account.viewer.memberships.get(body.spaceId) !== 'admin')
        throw new Failure(403, 'ACCESS_DENIED');
      return tx
        .update(spaces)
        .set({ aiEnabled: body.enabled })
        .where(and(eq(spaces.id, body.spaceId), eq(spaces.kind, 'household')))
        .returning({ enabled: spaces.aiEnabled });
    });
    if (!changed[0]) throw new Failure(403, 'ACCESS_DENIED');
    return changed[0];
  });
  app.post('/api/ai/extract', async (request, reply) => {
    const account = await accountReader(request, reply);
    if (!account) return reply;
    const body = parse(ExtractInput, request.body);
    const { row } = await house(account.id, body.spaceId);
    if (!row.aiEnabled) throw new Failure(403, 'AI_DISABLED');
    if (ai.AI_EXTRACT_PROVIDER === 'disabled') throw new Failure(503, 'AI_UNAVAILABLE');
    const context = await options.appDb.withAccount(account.id, async (tx) => {
      const visibleObjects = await tx
        .select()
        .from(objects)
        .where(and(eq(objects.spaceId, body.spaceId), isNull(objects.deletedAt)))
        // Частота использования — число видимых активных связей; RLS скрывает чужие концы.
        .orderBy(
          desc(
            sql`(SELECT count(*) FROM ${recordLinks} WHERE ${recordLinks.deletedAt} IS NULL AND ((${recordLinks.leftTable}='objects' AND ${recordLinks.leftId}=${objects.id}) OR (${recordLinks.rightTable}='objects' AND ${recordLinks.rightId}=${objects.id})))`,
          ),
          desc(objects.updatedAt),
          objects.id,
        );
      const members = await tx
        .select()
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, body.spaceId), isNull(spaceMembers.leftAt)));
      return {
        objects: visibleObjects
          .filter((o) => canView(account.viewer, factsOf(o).placement))
          .slice(0, 50)
          .map((o) => ({ id: o.id, title: o.title })),
        members: members
          .filter((m) => canViewMembership(account.viewer, m.accountId, body.spaceId))
          .map((m) => ({ id: m.accountId, name: m.displayName })),
        timeZone: row.timeZone ?? options.homeTimeZone,
        now: new Date(),
      };
    });
    // Короткая транзакция заканчивается ДО сетевого вызова; расход лимита переживает сбой поставщика.
    const consumed = await options.appDb.withAccount(
      account.id,
      async (tx) =>
        (
          await tx.execute<{ ok: boolean }>(
            sql`SELECT app.consume_ai_request(${body.spaceId}::uuid,${ai.AI_DAILY_LIMIT}::integer) AS ok`,
          )
        ).rows[0]?.ok,
    );
    if (!consumed)
      throw new Failure(429, 'AI_DAILY_LIMIT', 'Дневной предел ИИ исчерпан. Можно ввести вручную.');
    const started = Date.now();
    let code = 'OK';
    try {
      return await providers.extractor.extract({ kind: body.kind, text: body.text, context });
    } catch (error) {
      code = error instanceof Failure ? error.code : 'AI_UNAVAILABLE';
      throw error;
    } finally {
      request.log.info(
        {
          operation: 'extract',
          provider: ai.AI_EXTRACT_PROVIDER,
          durationMs: Date.now() - started,
          size: Buffer.byteLength(body.text),
          code,
        },
        'AI operation finished',
      );
    }
  });
  app.post('/api/ai/transcribe', async (request, reply) => {
    const account = await accountReader(request, reply);
    if (!account) return reply;
    const { spaceId } = parse(House, request.query);
    if (!(await house(account.id, spaceId)).row.aiEnabled) throw new Failure(403, 'AI_DISABLED');
    const file = await request.file();
    if (file?.fieldname !== 'file') throw new Failure(400, 'AI_INVALID_AUDIO');
    const bytes = await file.toBuffer();
    if (file.file.truncated) throw new Failure(413, 'AI_INVALID_AUDIO');
    let durationMs: number;
    try {
      const metadata = await parseBuffer(
        bytes,
        { mimeType: file.mimetype },
        { duration: true, skipCovers: true },
      );
      durationMs = (metadata.format.duration ?? 0) * 1000;
    } catch {
      throw new Failure(400, 'AI_INVALID_AUDIO');
    }
    const audio = { bytes, mime: file.mimetype, durationMs };
    validateAudio(audio);
    const started = Date.now();
    try {
      const result = await providers.speech.transcribe(audio, { lang: 'ru' });
      return { text: result.text };
    } finally {
      request.log.info(
        {
          operation: 'transcribe',
          provider: ai.AI_STT_PROVIDER,
          durationMs: Date.now() - started,
          size: bytes.length,
        },
        'AI operation finished',
      );
    }
  });
}
