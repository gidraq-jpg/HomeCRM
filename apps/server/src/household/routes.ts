import {
  accounts,
  and,
  type Database,
  eq,
  invitations,
  isNull,
  memberProfiles,
  spaceMembers,
  sql,
  type Transaction,
} from '@homecrm/db';
import {
  canChangeRole,
  canExclude,
  canInvite,
  canLeave,
  canViewMembership,
  mustUseSecondFactor,
  ROLES,
  type Role,
} from '@homecrm/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import { type Account, createAccountReader } from '../auth/account.ts';
import { loadViewer, pgError } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';

class Failure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const House = z.strictObject({ householdId: z.uuid() });
const Member = House.extend({ accountId: z.uuid() });
const Profile = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    photoFileId: z.uuid().nullable().optional(),
    birthDate: z.iso.date().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Failure(400, 'INVALID_INPUT');
  return result.data;
}

export async function householdRoutes(
  app: FastifyInstance,
  options: AuthModule & { worker?: Database },
) {
  const currentAccount = createAccountReader(options);
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
      'Household request failed',
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  async function members(tx: Transaction, account: Account, householdId: string) {
    if (!account.viewer.memberships.has(householdId)) throw new Failure(404, 'HOUSEHOLD_NOT_FOUND');
    const rows = await tx
      .select({
        accountId: spaceMembers.accountId,
        role: spaceMembers.role,
        isAdult: spaceMembers.isAdult,
        leftAt: spaceMembers.leftAt,
        displayName: spaceMembers.displayName,
        photoFileId: memberProfiles.photoFileId,
        birthDate: memberProfiles.birthDate,
        phone: memberProfiles.phone,
      })
      .from(spaceMembers)
      .leftJoin(memberProfiles, eq(memberProfiles.accountId, spaceMembers.accountId))
      .where(eq(spaceMembers.spaceId, householdId))
      .orderBy(spaceMembers.createdAt, spaceMembers.accountId);
    return rows
      .filter((row) => canViewMembership(account.viewer, row.accountId, householdId))
      .map((row) => ({
        ...row,
        formerMember: row.leftAt !== null,
        ...(row.leftAt !== null ? { photoFileId: null, birthDate: null, phone: null } : {}),
      }));
  }
  app.get('/api/me/profile', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    return options.appDb.withAccount(account.id, async (tx) => {
      const [profile] = await tx
        .select()
        .from(memberProfiles)
        .where(eq(memberProfiles.accountId, account.id));
      return profile;
    });
  });
  app.patch('/api/me/profile', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const body = parse(Profile, request.body);
    return options.appDb.withAccount(account.id, async (tx) => {
      const [profile] = await tx
        .update(memberProfiles)
        .set(body)
        .where(eq(memberProfiles.accountId, account.id))
        .returning();
      return profile;
    });
  });
  app.get('/api/households/:householdId/members', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId } = parse(House, request.params);
    return options.appDb.withAccount(account.id, (tx) => members(tx, account, householdId));
  });
  // Приглашение создаёт существующий POST /api/invitations { householdId, role } (AUTH-2).
  app.get('/api/households/:householdId/invitations', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId } = parse(House, request.params);
    if (!canInvite(account.viewer, householdId)) throw new Failure(403, 'ACCESS_DENIED');
    return options.appDb.withAccount(account.id, (tx) =>
      tx
        .select({
          id: invitations.id,
          role: invitations.role,
          createdAt: invitations.createdAt,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.householdId, householdId),
            isNull(invitations.revokedAt),
            isNull(invitations.acceptedAt),
            sql`${invitations.expiresAt} > now()`,
          ),
        )
        .orderBy(invitations.createdAt, invitations.id),
    );
  });
  async function mutate(
    account: Account,
    householdId: string,
    accountId: string,
    action: 'leave' | 'exclude' | 'role',
    role?: Role,
  ) {
    if (action !== 'role' && !options.worker) throw new Failure(503, 'WORKER_UNAVAILABLE');
    const result = await options.appDb.withAccount(account.id, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${householdId}::text, 0))`,
      );
      const fresh = { ...account, viewer: await loadViewer(tx, account.id) };
      // Роль могла измениться между чтением сессии и получением блокировки дома.
      if (mustUseSecondFactor(fresh.viewer)) {
        const [identity] = await tx
          .select({ enabled: accounts.twoFactorEnabled })
          .from(accounts)
          .where(eq(accounts.id, account.id));
        if (!identity?.enabled) throw new Failure(403, 'SECOND_FACTOR_REQUIRED');
      }
      const roster = await members(tx, fresh, householdId);
      const target = roster.find(
        (member) => member.accountId === accountId && !member.formerMember,
      );
      if (!target) throw new Failure(404, 'MEMBER_NOT_FOUND');
      const adminIds = roster
        .filter((member) => member.role === 'admin' && !member.formerMember)
        .map((member) => member.accountId);
      const viewer = { accountId, memberships: new Map([[householdId, target.role]]) };
      if (action === 'role') {
        if (!role || !canInvite(fresh.viewer, householdId)) throw new Failure(403, 'ACCESS_DENIED');
        if (!canChangeRole(fresh.viewer, householdId, viewer, role, adminIds))
          throw new Failure(409, 'LAST_ADMIN');
      } else {
        if (action === 'exclude' && !canExclude(fresh.viewer, householdId, viewer))
          throw new Failure(403, 'ACCESS_DENIED');
        if (!canLeave(viewer, householdId, adminIds)) throw new Failure(409, 'LAST_ADMIN');
      }
      const [changed] = await tx
        .update(spaceMembers)
        .set(action === 'role' ? { role } : { leftAt: sql`now()`, leftBy: account.id })
        .where(
          and(
            eq(spaceMembers.spaceId, householdId),
            eq(spaceMembers.accountId, accountId),
            isNull(spaceMembers.leftAt),
          ),
        )
        .returning({
          accountId: spaceMembers.accountId,
          role: spaceMembers.role,
          leftAt: spaceMembers.leftAt,
        });
      if (!changed) throw new Failure(409, 'CONFLICT');
      return changed;
    });
    // Передача идемпотентна; периодический проход повторяет её при сбое после фиксации ухода.
    if (action !== 'role' && options.worker) {
      try {
        await options.worker.execute(sql`SELECT app.reassign_responsibility()`);
      } catch (error) {
        const { code } = pgError(error);
        app.log.error(
          { databaseCode: /^[A-Z0-9]{5}$/.test(code ?? '') ? code : undefined },
          'Responsibility reassignment deferred',
        );
        throw new Failure(503, 'RESPONSIBILITY_PENDING');
      }
    }
    return result;
  }
  app.patch('/api/households/:householdId/members/:accountId/role', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId, accountId } = parse(Member, request.params);
    const { role } = parse(z.strictObject({ role: z.enum(ROLES) }), request.body);
    return mutate(account, householdId, accountId, 'role', role);
  });
  app.post('/api/households/:householdId/members/:accountId/exclude', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId, accountId } = parse(Member, request.params);
    parse(z.strictObject({}), request.body ?? {});
    return mutate(account, householdId, accountId, 'exclude');
  });
  app.post('/api/households/:householdId/leave', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId } = parse(House, request.params);
    parse(z.strictObject({}), request.body ?? {});
    return mutate(account, householdId, account.id, 'leave');
  });
  app.post(
    '/api/households/:householdId/members/:accountId/password-reset',
    async (request, reply) => {
      const account = await currentAccount(request, reply);
      if (!account) return reply;
      const { householdId, accountId } = parse(Member, request.params);
      parse(z.strictObject({}), request.body ?? {});
      if (!canInvite(account.viewer, householdId)) throw new Failure(403, 'ACCESS_DENIED');
      const roster = await options.appDb.withAccount(account.id, (tx) =>
        members(tx, account, householdId),
      );
      if (
        !roster.some(
          (member) =>
            member.accountId === accountId && member.role === 'child' && !member.formerMember,
        )
      )
        throw new Failure(403, 'RESET_NOT_ALLOWED');
      const response = await options.auth.api.createChildResetLink({
        headers: fromNodeHeaders(request.headers),
        body: { accountId },
        asResponse: true,
      });
      reply.code(response.status);
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(await response.json());
    },
  );
}
