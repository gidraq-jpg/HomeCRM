import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, appRole, authPolicies, createdAt, id, spaces } from './core.ts';

// Служебные сущности всегда личные. Поля доступа вычисляемые: перенос и корзина запрещены.
const personalAccess = () => ({
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id),
  spaceKind: text('space_kind').generatedAlwaysAs(sql`'personal'::text`),
  audience: text('audience').generatedAlwaysAs(sql`NULL::text`),
  authorId: uuid('author_id').generatedAlwaysAs(sql`account_id`),
  assigneeId: uuid('assignee_id').generatedAlwaysAs(sql`account_id`),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).generatedAlwaysAs(
    sql`NULL::timestamptz`,
  ),
});

export const chatClients = pgTable(
  'chat_clients',
  {
    id: id(),
    name: text('name').notNull(),
    redirects: jsonb('redirects').$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  () => authPolicies('chat_clients', ['select', 'insert', 'delete']),
).enableRLS();

export const chatGrants = pgTable(
  'chat_grants',
  {
    id: id(),
    ...personalAccess(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    houseId: uuid('house_id')
      .notNull()
      .references(() => spaces.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => chatClients.id),
    name: text('name').notNull(),
    accessHash: text('access_hash').notNull().unique(),
    refreshHash: text('refresh_hash').notNull().unique(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    minute: integer('minute').notNull().default(0),
    minuteCount: integer('minute_count').notNull().default(0),
    day: integer('day').notNull().default(0),
    dayCount: integer('day_count').notNull().default(0),
  },
  () => [
    ...authPolicies('chat_grants', ['select', 'insert', 'update', 'delete']),
    pgPolicy('chat_grants_own_select', {
      for: 'select',
      to: appRole,
      using: sql`account_id=app.current_account_id()`,
    }),
    pgPolicy('chat_grants_own_delete', {
      for: 'delete',
      to: appRole,
      using: sql`account_id=app.current_account_id()`,
    }),
  ],
).enableRLS();

export const chatCodes = pgTable(
  'chat_codes',
  {
    hash: text('hash').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    houseId: uuid('house_id')
      .notNull()
      .references(() => spaces.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => chatClients.id),
    redirect: text('redirect').notNull(),
    challenge: text('challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  () => authPolicies('chat_codes', ['select', 'insert', 'update', 'delete']),
).enableRLS();

// Личный служебный журнал: без содержимого, поиска и корзины; экспортируется автору.
export const chatEvents = pgTable(
  'chat_events',
  {
    id: id(),
    ...personalAccess(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    action: text('action').notNull(),
    kind: text('kind'),
  },
  () => [
    check(
      'chat_events_action',
      sql`action IN ('find_objects','find_people','list_meters','create_drafts')`,
    ),
    pgPolicy('chat_events_own_select', {
      for: 'select',
      to: appRole,
      using: sql`account_id=app.current_account_id()`,
    }),
    pgPolicy('chat_events_own_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`account_id=app.current_account_id()`,
    }),
  ],
).enableRLS();
