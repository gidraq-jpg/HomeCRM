import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, appRole, createdAt, id, workerRole } from './core.ts';
import { deadlineNotifications } from './deadlines-schema.ts';
import { sessions } from './schema.ts';

const ownerRole = pgRole('homecrm_owner').existing();
function ownPolicies(
  name: string,
  operations: readonly ('select' | 'insert' | 'update' | 'delete')[],
) {
  return operations.map((op) =>
    pgPolicy(`${name}_own_${op}`, {
      for: op,
      to: appRole,
      ...(op === 'insert' ? {} : { using: sql`account_id = app.current_account_id()` }),
      ...(['insert', 'update'].includes(op)
        ? { withCheck: sql`account_id = app.current_account_id()` }
        : {}),
    }),
  );
}
function workerPolicies(
  name: string,
  operations: readonly ('select' | 'insert' | 'update' | 'delete')[],
) {
  return operations.map((op) =>
    pgPolicy(`${name}_worker_${op}`, {
      for: op,
      to: workerRole,
      ...(op === 'insert' ? {} : { using: sql`true` }),
      ...(['insert', 'update'].includes(op) ? { withCheck: sql`true` } : {}),
    }),
  );
}
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    sessionId: uuid('session_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    deviceName: text('device_name').notNull(),
    createdAt: createdAt(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  },
  (t) => [
    unique('push_subscriptions_endpoint_key').on(t.endpoint),
    unique('push_subscriptions_session_key').on(t.sessionId),
    foreignKey({
      columns: [t.sessionId, t.accountId],
      foreignColumns: [sessions.id, sessions.userId],
      name: 'push_subscriptions_session_owner_fk',
    }).onDelete('cascade'),
    ...ownPolicies('push_subscriptions', ['select', 'insert', 'update', 'delete']),
    ...workerPolicies('push_subscriptions', ['select', 'update', 'delete']),
    pgPolicy('push_subscriptions_leave', {
      for: 'all',
      to: ownerRole,
      using: sql`pg_trigger_depth() > 0`,
      withCheck: sql`pg_trigger_depth() > 0`,
    }),
  ],
);
export const notificationSettings = pgTable(
  'notification_settings',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id),
    quietStart: text('quiet_start').notNull().default('22:00'),
    quietEnd: text('quiet_end').notNull().default('08:00'),
    dailyBudget: integer('daily_budget').notNull().default(5),
    enabledKinds: jsonb('enabled_kinds').$type<string[]>().notNull().default(['deadline']),
    hideText: boolean('hide_text').notNull().default(true),
  },
  () => [
    ...ownPolicies('notification_settings', ['select', 'insert', 'update']),
    ...workerPolicies('notification_settings', ['select']),
    check('notification_settings_budget', sql`daily_budget BETWEEN 0 AND 100`),
    check(
      'notification_settings_clock',
      sql`quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'notification_settings_kinds',
      sql`enabled_kinds <@ '["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification"]'::jsonb AND jsonb_typeof(enabled_kinds) = 'array'`,
    ),
  ],
);
/** Идентификатор устройства сохраняется после отписки, но адрес и ключи в журнал не копируются. */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: id(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => deadlineNotifications.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    deviceId: uuid('device_id').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    budgetDate: date('budget_date'),
  },
  (t) => [
    unique('push_deliveries_once').on(t.notificationId, t.deviceId),
    index('push_deliveries_due').on(t.status, t.nextAttemptAt),
    check(
      'push_deliveries_status',
      sql`status IN ('pending','sending','sent','cancelled','summary','gone')`,
    ),
    ...workerPolicies('push_deliveries', ['select', 'insert', 'update', 'delete']),
  ],
);
export const pushAttempts = pgTable(
  'push_attempts',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    deviceId: uuid('device_id').notNull(),
    kind: text('kind').notNull().default('deadline'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    result: text('result').notNull(),
    errorCode: integer('error_code'),
  },
  (t) => [
    index('push_attempts_recent').on(t.accountId, t.attemptedAt),
    ...ownPolicies('push_attempts', ['select']),
    ...workerPolicies('push_attempts', ['select', 'insert']),
    pgPolicy('push_attempts_worker_delete', {
      for: 'delete',
      to: workerRole,
      using: sql`attempted_at < now() - interval '90 days'`,
    }),
  ],
);
