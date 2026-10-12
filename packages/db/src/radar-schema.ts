import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  accounts,
  appRole,
  audienceEnum,
  createdAt,
  id,
  spaceKindEnum,
  spaces,
  workerRole,
} from './core.ts';
import { deadlines } from './deadlines-schema.ts';

export const radarActionVisible = 'EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id)';
export const radarActionWritable = 'app.radar_can_write(deadline_id)';
export const radarActions = pgTable(
  'radar_actions',
  {
    id: id(),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    calendarKey: text('calendar_key').notNull(),
    date: date('date').notNull(),
    status: text('status').notNull(),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    reason: text('reason'),
    version: integer('version').notNull().default(1),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    history: jsonb('history').notNull().default([]),
    spaceId: uuid('space_id').notNull(),
    spaceKind: spaceKindEnum('space_kind').notNull(),
    audience: audienceEnum('audience'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => accounts.id),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => accounts.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('radar_actions_once').on(t.deadlineId, t.calendarKey, t.date),
    check(
      'radar_actions_state',
      sql`status IN ('active','snoozed','dismissed','completed') AND version>0 AND (status<>'dismissed' OR length(trim(reason)) BETWEEN 1 AND 2000) AND (status<>'snoozed' OR snoozed_until IS NOT NULL) AND calendar_key ~ '^[a-f0-9]{32}$'`,
    ),
    pgPolicy('radar_actions_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(radarActionVisible),
    }),
    pgPolicy('radar_actions_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql.raw(radarActionWritable),
    }),
    pgPolicy('radar_actions_update', {
      for: 'update',
      to: appRole,
      using: sql.raw(radarActionWritable),
      withCheck: sql.raw(radarActionWritable),
    }),
    pgPolicy('radar_actions_worker_select', { for: 'select', to: workerRole, using: sql`true` }),
  ],
);

export const summaryOwnSql =
  'account_id=app.current_account_id() AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=household_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL)';
export const summaries = pgTable(
  'summaries',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    timeZone: text('time_zone').notNull(),
    kind: text('kind').$type<'morning' | 'weekly'>().notNull(),
    localDate: date('local_date').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('summaries_period').on(t.accountId, t.householdId, t.kind, t.localDate),
    check('summaries_calendar', sql`kind IN ('morning','weekly') AND period_start<period_end`),
    pgPolicy('summaries_select', { for: 'select', to: appRole, using: sql.raw(summaryOwnSql) }),
    ...(['select', 'insert'] as const).map((op) =>
      pgPolicy(`summaries_worker_${op}`, {
        for: op,
        to: workerRole,
        ...(op === 'insert' ? { withCheck: sql`true` } : { using: sql`true` }),
      }),
    ),
  ],
);
