import { createHash, randomBytes } from 'node:crypto';
import { and, chatClients, chatCodes, chatEvents, chatGrants, desc, eq, spaces } from '@homecrm/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import { reserveSessionRequest } from '../auth/rate-limit.ts';
import type { AuthModule } from '../auth/routes.ts';
import { Failure } from '../objects/support.ts';

export const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const secret = () => randomBytes(32).toString('base64url');
export const idle = (date: Date) => date.getTime() < Date.now() - 90 * 86400000;
const Redirect = z
  .url()
  .max(2000)
  .refine((s) => {
    const u = new URL(s);
    return (
      !u.hash &&
      !u.username &&
      !u.password &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    );
  });
export const Authorization = z.object({
  client_id: z.uuid(),
  redirect_uri: Redirect,
  response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[\w-]{43}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
  scope: z.literal('chat').optional(),
});
export async function chatHouse(module: AuthModule, accountId: string, houseId: string) {
  return module.appDb.withAccount(accountId, async (tx) => {
    const [house] = await tx
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, houseId), eq(spaces.kind, 'household')));
    if (!house?.chatEnabled)
      throw new Failure(403, 'CHAT_DISABLED', 'ИИ через чат выключен администратором дома.');
    return house;
  });
}
export async function oauthRoutes(app: FastifyInstance, module: AuthModule) {
  const current = createAccountReader(module),
    resource = `${module.baseURL}/mcp`;
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/oauth/')) {
      const retry = await reserveSessionRequest(module.db, `oauth:${req.ip}`);
      if (retry !== null)
        return reply
          .code(429)
          .header('retry-after', String(retry))
          .send({ error: 'temporarily_unavailable' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    req.log.info(
      {
        kind: error instanceof Error ? error.name : 'unknown',
        code:
          error instanceof Error &&
          error.cause &&
          typeof error.cause === 'object' &&
          'code' in error.cause
            ? error.cause.code
            : undefined,
      },
      'OAuth request failed',
    );
    return reply.code(error instanceof Failure ? error.status : 400).send({
      error:
        error instanceof Failure && error.code === 'INVALID_GRANT'
          ? 'invalid_grant'
          : 'invalid_request',
      message:
        error instanceof Failure
          ? (error.publicMessage ?? error.code)
          : 'Проверьте параметры подключения.',
    });
  });
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: module.baseURL,
    authorization_endpoint: `${module.baseURL}/oauth/authorize`,
    token_endpoint: `${module.baseURL}/oauth/token`,
    registration_endpoint: `${module.baseURL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['chat'],
  }));
  const metadata = async () => ({
    resource,
    authorization_servers: [module.baseURL],
    scopes_supported: ['chat'],
    bearer_methods_supported: ['header'],
  });
  app.get('/.well-known/oauth-protected-resource', metadata);
  app.get('/.well-known/oauth-protected-resource/mcp', metadata);
  app.post('/oauth/register', { bodyLimit: 8192 }, async (req, reply) => {
    const v = z
      .object({
        client_name: z.string().trim().min(1).max(100),
        redirect_uris: z.array(Redirect).min(1).max(5),
        token_endpoint_auth_method: z.literal('none').optional(),
        grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
        response_types: z.array(z.literal('code')).optional(),
      })
      .parse(req.body);
    if ((await module.db.select().from(chatClients).limit(1001)).length >= 1000)
      throw new Failure(429, 'REGISTRATION_LIMIT');
    const [client] = await module.db
      .insert(chatClients)
      .values({ name: v.client_name, redirects: v.redirect_uris })
      .returning();
    return reply.code(201).send({
      client_id: client?.id,
      client_name: v.client_name,
      redirect_uris: v.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });
  async function validate(input: unknown) {
    const v = Authorization.parse(input);
    const [client] = await module.db
      .select()
      .from(chatClients)
      .where(eq(chatClients.id, v.client_id));
    if (!client?.redirects.includes(v.redirect_uri) || (v.resource && v.resource !== resource))
      throw new Failure(400, 'INVALID_CLIENT');
    return { v, client };
  }
  app.get('/oauth/authorize', async (req, reply) => {
    await validate(req.query);
    return reply.redirect(
      `/#/oauth/consent?${new URLSearchParams(req.query as Record<string, string>)}`,
    );
  });
  app.get('/api/chat/consent', async (req, reply) => {
    const account = await current(req, reply);
    if (!account) return reply;
    const { v, client } = await validate(req.query);
    const houses = await module.appDb.withAccount(account.id, (tx) =>
      tx
        .select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.kind, 'household'), eq(spaces.chatEnabled, true))),
    );
    // Название клиент выбирает сам при регистрации; адрес возврата показывает, кто получит доступ.
    return { name: client.name, host: new URL(v.redirect_uri).host, houses };
  });
  app.post('/api/chat/consent', async (req, reply) => {
    const account = await current(req, reply);
    if (!account) return reply;
    const body = z
        .object({ authorization: Authorization, houseId: z.uuid(), approve: z.boolean() })
        .parse(req.body),
      { v } = await validate(body.authorization),
      url = new URL(v.redirect_uri);
    if (v.state) url.searchParams.set('state', v.state);
    if (!body.approve) {
      url.searchParams.set('error', 'access_denied');
      return { redirect: url.href };
    }
    await chatHouse(module, account.id, body.houseId);
    const code = secret();
    await module.db.insert(chatCodes).values({
      hash: hash(code),
      accountId: account.id,
      houseId: body.houseId,
      clientId: v.client_id,
      redirect: v.redirect_uri,
      challenge: v.code_challenge,
      expiresAt: new Date(Date.now() + 300000),
    });
    url.searchParams.set('code', code);
    return { redirect: url.href };
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  app.post('/oauth/token', { bodyLimit: 8192 }, async (req, _reply) => {
    const v = z
      .object({
        grant_type: z.enum(['authorization_code', 'refresh_token']),
        client_id: z.uuid(),
        code: z.string().max(200).optional(),
        redirect_uri: Redirect.optional(),
        code_verifier: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{43,128}$/)
          .optional(),
        refresh_token: z.string().max(200).optional(),
        resource: z.string().optional(),
      })
      .parse(req.body);
    if (v.resource && v.resource !== resource) throw new Failure(400, 'INVALID_RESOURCE');
    return module.db.transaction(async (tx) => {
      let owner: string, houseId: string, name: string, grantId: string | undefined;
      if (v.grant_type === 'authorization_code') {
        const [code] = await tx
          .select()
          .from(chatCodes)
          .where(eq(chatCodes.hash, hash(v.code ?? '')))
          .for('update');
        if (
          !code ||
          code.clientId !== v.client_id ||
          code.redirect !== v.redirect_uri ||
          code.expiresAt.getTime() <= Date.now() ||
          code.challenge !== hash(v.code_verifier ?? '')
        )
          throw new Failure(400, 'INVALID_GRANT');
        await tx.delete(chatCodes).where(eq(chatCodes.hash, code.hash));
        owner = code.accountId;
        houseId = code.houseId;
        const [client] = await tx
          .select()
          .from(chatClients)
          .where(eq(chatClients.id, code.clientId));
        name = client?.name ?? 'Чат ИИ';
      } else {
        const [grant] = await tx
          .select()
          .from(chatGrants)
          .where(eq(chatGrants.refreshHash, hash(v.refresh_token ?? '')))
          .for('update');
        if (!grant || grant.clientId !== v.client_id || idle(grant.lastUsedAt))
          throw new Failure(400, 'INVALID_GRANT');
        owner = grant.accountId;
        houseId = grant.houseId;
        name = grant.name;
        grantId = grant.id;
      }
      await chatHouse(module, owner, houseId);
      const access = secret(),
        refresh = secret();
      const values = {
        spaceId:
          (
            await module.appDb.withAccount(
              owner,
              async (db) =>
                (
                  await db
                    .select({ id: spaces.id })
                    .from(spaces)
                    .where(eq(spaces.ownerAccountId, owner))
                )[0],
            )
          )?.id ?? '',
        accountId: owner,
        houseId,
        clientId: v.client_id,
        name,
        accessHash: hash(access),
        refreshHash: hash(refresh),
        accessExpiresAt: new Date(Date.now() + 3600000),
      };
      if (grantId) await tx.update(chatGrants).set(values).where(eq(chatGrants.id, grantId));
      else await tx.insert(chatGrants).values(values);
      return {
        access_token: access,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'chat',
      };
    });
  });
  app.get('/api/chat/devices', async (req, reply) => {
    const a = await current(req, reply);
    if (!a) return reply;
    return module.appDb.withAccount(a.id, (tx) =>
      tx
        .select({ id: chatGrants.id, name: chatGrants.name, lastUsedAt: chatGrants.lastUsedAt })
        .from(chatGrants),
    );
  });
  app.post('/api/chat/revoke', async (req, reply) => {
    const a = await current(req, reply);
    if (!a) return reply;
    const { id } = z.strictObject({ id: z.uuid() }).parse(req.body);
    await module.appDb.withAccount(a.id, (tx) =>
      tx.delete(chatGrants).where(eq(chatGrants.id, id)),
    );
    return { ok: true };
  });
  app.get('/api/chat/events', async (req, reply) => {
    const a = await current(req, reply);
    if (!a) return reply;
    return module.appDb.withAccount(a.id, (tx) =>
      tx.select().from(chatEvents).orderBy(desc(chatEvents.createdAt)).limit(100),
    );
  });
  app.get('/api/chat/settings/:id', async (req, reply) => {
    const a = await current(req, reply);
    if (!a) return reply;
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return module.appDb.withAccount(a.id, async (tx) => {
      const [s] = await tx
        .select({ enabled: spaces.chatEnabled })
        .from(spaces)
        .where(eq(spaces.id, id));
      return s ?? { enabled: false };
    });
  });
  app.post('/api/chat/settings', async (req, reply) => {
    const a = await current(req, reply);
    if (!a) return reply;
    const v = z.strictObject({ id: z.uuid(), enabled: z.boolean() }).parse(req.body);
    if (a.viewer.memberships.get(v.id) !== 'admin') throw new Failure(403, 'FORBIDDEN');
    await module.appDb.withAccount(a.id, (tx) =>
      tx.update(spaces).set({ chatEnabled: v.enabled }).where(eq(spaces.id, v.id)),
    );
    return { ok: true };
  });
}
