import { desc, eq, notificationSettings, pushAttempts, pushSubscriptions } from '@homecrm/db';
import {
  NotificationSettings,
  NotificationSettingsPatch,
  PushSubscriptionInput,
} from '@homecrm/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';

/** Контракт для R0.7b. Адреса и ключи устройств не возвращаются даже в списке своих устройств. */
export const notificationRoutes: FastifyPluginAsync<AuthModule & { publicKey?: string }> = async (
  app,
  module,
) => {
  const current = createAccountReader(module);
  app.get('/api/push/key', async (_request, reply) =>
    module.publicKey
      ? { publicKey: module.publicKey }
      : reply.code(503).send({ code: 'PUSH_NOT_CONFIGURED' }),
  );
  app.get('/api/push/subscriptions', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    return module.appDb.withAccount(account.id, (tx) =>
      tx
        .select({
          id: pushSubscriptions.id,
          deviceName: pushSubscriptions.deviceName,
          createdAt: pushSubscriptions.createdAt,
          lastSuccessAt: pushSubscriptions.lastSuccessAt,
        })
        .from(pushSubscriptions)
        .orderBy(pushSubscriptions.createdAt, pushSubscriptions.id),
    );
  });
  app.post('/api/push/subscriptions', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    const parsed = PushSubscriptionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_SUBSCRIPTION' });
    if (!account.viewer.memberships.size) return reply.code(403).send({ code: 'HOUSE_REQUIRED' });
    try {
      const { endpoint, keys, deviceName } = parsed.data;
      const [item] = await module.appDb.withAccount(account.id, (tx) =>
        tx
          .insert(pushSubscriptions)
          .values({
            accountId: account.id,
            sessionId: account.sessionId,
            endpoint,
            ...keys,
            deviceName,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.sessionId,
            set: { endpoint, ...keys, deviceName },
          })
          .returning({ id: pushSubscriptions.id, deviceName: pushSubscriptions.deviceName }),
      );
      return reply.code(201).send(item);
    } catch (error) {
      // Ошибка уникальности и RLS может содержать endpoint: не отдаём её Fastify и журналу.
      let cause: unknown = error;
      for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
        if ('code' in cause && ['23505', '23503', '42501'].includes(String(cause.code)))
          return reply.code(409).send({ code: 'SUBSCRIPTION_CONFLICT' });
        cause = 'cause' in cause ? cause.cause : null;
      }
      app.log.error('Push subscription storage failed');
      return reply.code(500).send({ code: 'PUSH_STORAGE_FAILED' });
    }
  });
  app.delete('/api/push/subscriptions/:id', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    const parsed = z.strictObject({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_ID' });
    const rows = await module.appDb.withAccount(account.id, (tx) =>
      tx
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, parsed.data.id))
        .returning({ id: pushSubscriptions.id }),
    );
    return rows.length ? reply.code(204).send() : reply.code(404).send({ code: 'NOT_FOUND' });
  });
  app.get('/api/notifications/settings', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    const [settings] = await module.appDb.withAccount(account.id, (tx) =>
      tx.select().from(notificationSettings),
    );
    return NotificationSettings.strip().parse(settings ?? {});
  });
  app.patch('/api/notifications/settings', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    const parsed = NotificationSettingsPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_SETTINGS' });
    if (!Object.keys(parsed.data).length) {
      const [settings] = await module.appDb.withAccount(account.id, (tx) =>
        tx.select().from(notificationSettings),
      );
      return NotificationSettings.strip().parse(settings ?? {});
    }
    const [settings] = await module.appDb.withAccount(account.id, (tx) =>
      tx
        .insert(notificationSettings)
        .values({ accountId: account.id, ...parsed.data })
        .onConflictDoUpdate({
          target: notificationSettings.accountId,
          set: parsed.data,
        })
        .returning(),
    );
    return NotificationSettings.strip().parse(settings);
  });
  app.get('/api/notifications/deliveries', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return;
    return module.appDb.withAccount(account.id, (tx) =>
      tx
        .select()
        .from(pushAttempts)
        .orderBy(desc(pushAttempts.attemptedAt), desc(pushAttempts.id))
        .limit(100),
    );
  });
};
