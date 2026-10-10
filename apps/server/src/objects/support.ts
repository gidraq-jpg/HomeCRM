import {
  eq,
  RECORD_DEFINITIONS,
  RECORD_TABLES,
  type RecordType,
  spaces,
  type Transaction,
} from '@homecrm/db';
import {
  canView,
  canViewTimelineEvent,
  canWrite,
  type Placement,
  type RecordFacts,
} from '@homecrm/shared';
import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import type { z } from 'zod';
import { type Account, createAccountReader } from '../auth/account.ts';
import { pgError } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';

export class Failure extends Error {
  status: number;
  code: string;
  publicMessage?: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, publicMessage?: string) {
    super(code);
    this.status = status;
    this.code = code;
    if (publicMessage) this.publicMessage = publicMessage;
  }
}
export function deny(): never {
  throw new Failure(403, 'ACCESS_DENIED');
}
export function missing(): never {
  throw new Failure(404, 'NOT_FOUND');
}
export function tableForType(type: RecordType): string {
  const definition = RECORD_DEFINITIONS.find((value) => value.type === type);
  if (!definition) missing();
  return definition.name;
}
export function typeForTable(table: string): RecordType {
  const definition = RECORD_DEFINITIONS.find((value) => value.name === table);
  if (!definition) missing();
  return definition.type;
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Failure(400, 'INVALID_INPUT');
  return result.data;
}
export interface Row {
  id: string;
  spaceId: string;
  spaceKind: 'personal' | 'household';
  audience: 'household' | 'adults' | null;
  authorId: string;
  assigneeId: string | null;
  deletedAt: Date | null;
}
export const placementOf = (
  row: Pick<Row, 'spaceId' | 'spaceKind' | 'audience' | 'assigneeId'>,
): Placement =>
  row.spaceKind === 'personal'
    ? { kind: 'personal', spaceId: row.spaceId, ownerId: row.assigneeId ?? '' }
    : { kind: 'household', spaceId: row.spaceId, audience: row.audience ?? 'household' };
export const factsOf = (row: Row, type: RecordType = 'object'): RecordFacts => ({
  type,
  placement: placementOf(row),
  authorId: row.authorId,
  assigneeId: row.assigneeId,
  trashed: row.deletedAt !== null,
});
export const columnsOf = (place: Placement) => ({
  spaceId: place.spaceId,
  spaceKind: place.kind,
  audience: place.kind === 'household' ? place.audience : null,
});
export async function placementFrom(
  tx: Transaction,
  account: Account,
  spaceId?: string,
  audience?: 'household' | 'adults',
  defaultAudience: 'household' | 'adults' = 'household',
): Promise<Placement> {
  const [space] = await tx
    .select()
    .from(spaces)
    .where(spaceId ? eq(spaces.id, spaceId) : eq(spaces.ownerAccountId, account.id));
  if (!space) missing();
  if (space.kind === 'personal') {
    if (audience) throw new Failure(400, 'INVALID_INPUT');
    return { kind: 'personal', spaceId: space.id, ownerId: space.ownerAccountId ?? '' };
  }
  return { kind: 'household', spaceId: space.id, audience: audience ?? defaultAudience };
}
export async function snapshotPlacement(
  tx: Transaction,
  spaceId: string,
  kind: 'personal' | 'household',
  audience: 'household' | 'adults' | null,
): Promise<Placement> {
  if (kind === 'household') return { kind, spaceId, audience: audience ?? 'household' };
  const [space] = await tx.select().from(spaces).where(eq(spaces.id, spaceId));
  return { kind, spaceId, ownerId: space?.ownerAccountId ?? '' };
}
export async function readReference(
  tx: Transaction,
  account: Account,
  ref: { type: RecordType; id: string },
) {
  const table = RECORD_TABLES[ref.type];
  const [row] = await tx.select().from(table).where(eq(table.id, ref.id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  if (
    'originSpaceId' in row &&
    !canViewTimelineEvent(
      account.viewer,
      factsOf(row, ref.type),
      await snapshotPlacement(tx, row.originSpaceId, row.originSpaceKind, row.originAudience),
    )
  )
    missing();
  return { row, facts: factsOf(row, ref.type) };
}
export function version(expected: string | undefined, actual: Date) {
  if (expected && new Date(expected).getTime() !== actual.getTime())
    throw new Failure(409, 'STALE_VERSION');
}
export type DataHandler = (
  tx: Transaction,
  account: Account,
  request: FastifyRequest,
) => Promise<unknown>;
export type DataRoute = (
  method: HTTPMethods,
  url: string,
  status: number,
  handler: DataHandler,
) => void;
export function dataRoutes(app: FastifyInstance, module: AuthModule): DataRoute {
  const currentAccount = createAccountReader(module);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Failure)
      return reply.code(error.status).send({
        code: error.code,
        ...error.details,
        ...(error.code === 'ASSIGNEE_NOT_VISIBLE' ? { requiresAudienceExpansion: true } : {}),
        ...(error.publicMessage ? { message: error.publicMessage } : {}),
      });
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
      'Objects request failed',
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  return (method, url, status, handler) =>
    app.route({
      method,
      url,
      handler: async (request, reply) => {
        const account = await currentAccount(request, reply);
        if (!account) return reply;
        const result = await module.appDb.withAccount(account.id, (tx) =>
          handler(tx, account, request),
        );
        return reply.code(status).send(result);
      },
    });
}
export function requireWrite(account: Account, row: Row, type: RecordType = 'object') {
  if (!canWrite(account.viewer, factsOf(row, type))) deny();
}
