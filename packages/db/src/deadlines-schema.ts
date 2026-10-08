import type { DeadlineRule } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { canViewSql } from './access-sql.ts';
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
import { meters, utilityAccounts, utilityCharges } from './schema.ts';

// Явная проверка пространства плюс чтение источника под его RLS. Подзапросы могут
// строиться один раз для списка; построчная PL/pgSQL-проверка здесь не нужна.
export const deadlineVisibleSql = `(${canViewSql()}) AND (EXISTS (SELECT 1 FROM notes n WHERE n.id=note_id) OR EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id))`;
export const deadlineWritableSql = `app.deadline_source_allowed(note_id, object_id, true)`;
export const deadlineCascadeSql = `pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid`;
const ownerRole = pgRole('homecrm_owner').existing();
export const deadlineRestoreSql = `deleted_at IS NOT NULL AND app.deadline_source_allowed(note_id, object_id, true) AND (space_kind='personal' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id=deadlines.space_id AND m.account_id=app.current_account_id() AND m.left_at IS NULL AND (m.role='admin' OR (m.role='adult' AND deadlines.author_id=app.current_account_id()))))`;
const accessColumns = () => ({
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
});
/** Правило хранит только настройки срока; тексты остаются в источнике. Метаданные ставит триггер. */
export const deadlines = pgTable(
  'deadlines',
  {
    id: id(),
    noteId: uuid('note_id'),
    objectId: uuid('object_id'),
    sourceKind: text('source_kind')
      .$type<'record' | 'readings' | 'payment' | 'verification'>()
      .notNull()
      .default('record'),
    utilityAccountId: uuid('utility_account_id').references(() => utilityAccounts.id, {
      onDelete: 'cascade',
    }),
    label: text('label'),
    chargeId: uuid('charge_id')
      .references(() => utilityCharges.id, { onDelete: 'cascade' })
      .unique(),
    meterId: uuid('meter_id').references(() => meters.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => spaces.id),
    rule: jsonb('rule').$type<DeadlineRule>().notNull(),
    needsRefresh: boolean('needs_refresh').notNull().default(true),
    ...accessColumns(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('deadlines_one_source', sql`(note_id IS NULL) <> (object_id IS NULL)`),
    check(
      'deadlines_utility_source',
      sql`(source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL AND (charge_id IS NULL OR source_kind='payment')) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL AND charge_id IS NULL)))`,
    ),
    uniqueIndex('deadlines_account_kind_key')
      .on(t.utilityAccountId, t.sourceKind)
      .where(sql`charge_id IS NULL`),
    unique('deadlines_meter_kind_key').on(t.meterId, t.sourceKind),
    index('deadlines_note_idx').on(t.noteId),
    index('deadlines_object_idx').on(t.objectId),
    foreignKey({ columns: [t.spaceId, t.spaceKind], foreignColumns: [spaces.id, spaces.kind] }),
    pgPolicy('deadlines_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(`(${deadlineVisibleSql}) OR (${deadlineCascadeSql})`),
    }),
    pgPolicy('deadlines_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql.raw(
        `${deadlineWritableSql} AND author_id = app.current_account_id() AND deleted_at IS NULL`,
      ),
    }),
    pgPolicy('deadlines_utility_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid`,
    }),
    pgPolicy('deadlines_utility_update', {
      for: 'update',
      to: appRole,
      using: sql`pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid`,
      withCheck: sql`pg_trigger_depth()>0 AND source_kind<>'record' AND coalesce(charge_id,utility_account_id,meter_id)=nullif(current_setting('app.utility_source_id',true),'')::uuid`,
    }),
    pgPolicy('deadlines_update', {
      for: 'update',
      to: appRole,
      using: sql.raw(
        `(deleted_at IS NULL AND (${deadlineWritableSql})) OR (${deadlineRestoreSql}) OR (${deadlineCascadeSql})`,
      ),
      withCheck: sql.raw(`(${deadlineWritableSql}) OR (${deadlineCascadeSql})`),
    }),
    ...(['select', 'update'] as const).map((op) =>
      pgPolicy(`deadlines_owner_${op}`, {
        for: op,
        to: ownerRole,
        using: sql.raw(deadlineCascadeSql),
        ...(op === 'update' ? { withCheck: sql.raw(deadlineCascadeSql) } : {}),
      }),
    ),
    pgPolicy('deadlines_engine', { for: 'select', to: workerRole, using: sql`true` }),
    pgPolicy('deadlines_purge', {
      for: 'delete',
      to: workerRole,
      using: sql`source_kind='record' AND deleted_at < now() - interval '30 days'`,
    }),
    // В миграции UPDATE выдан только на needs_refresh; прав на rule и ссылки нет.
    pgPolicy('deadlines_refresh', {
      for: 'update',
      to: workerRole,
      // SELECT FOR UPDATE нужен и ежедневному пересчёту уже чистых правил.
      // Выдача UPDATE только на needs_refresh проверяется privileges.test.ts.
      using: sql`true`,
      withCheck: sql`NOT needs_refresh`,
    }),
  ],
);
export const deadlineOccurrencesTable = pgTable(
  'deadline_occurrences',
  {
    id: id(),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timeZone: text('time_zone').notNull(),
    warningsAt: jsonb('warnings_at').$type<string[]>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...accessColumns(),
  },
  (t) => [
    unique('deadline_occurrences_date_key').on(t.deadlineId, t.date),
    index('deadline_occurrences_range_idx').on(t.startsAt, t.endsAt),
    pgPolicy('deadline_occurrences_select', {
      for: 'select',
      to: appRole,
      using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.id = deadline_id AND ((deadline_occurrences.deleted_at IS NULL AND d.deleted_at IS NULL ) OR (pg_trigger_depth() > 0 AND d.id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid)))`,
    }),
    // Метаданные меняются только из каскада родителя, прямых прав на действия радара пока нет.
    pgPolicy('deadline_occurrences_cascade', {
      for: 'update',
      to: appRole,
      using: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
      withCheck: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
    }),
    pgPolicy('deadline_occurrences_complete_payment', {
      for: 'update',
      to: appRole,
      using: sql`deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND (d.source_kind='payment' OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true))`,
      withCheck: sql`deleted_at IS NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=deadline_id AND (d.source_kind='payment' OR (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active))) AND d.deleted_at IS NULL AND app.deadline_source_allowed(d.note_id,d.object_id,true))`,
    }),
    ...(['select', 'update'] as const).map((op) =>
      pgPolicy(`deadline_occurrences_owner_${op}`, {
        for: op,
        to: ownerRole,
        using: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
        ...(op === 'update'
          ? {
              withCheck: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
            }
          : {}),
      }),
    ),
    ...(['select', 'insert', 'update', 'delete'] as const).map((op) =>
      pgPolicy(`deadline_occurrences_worker_${op}`, {
        for: op,
        to: workerRole,
        ...(op === 'insert' ? {} : { using: sql`true` }),
        ...(['insert', 'update'].includes(op) ? { withCheck: sql`true` } : {}),
      }),
    ),
  ],
);
/** Контракт R0.7: только идентификаторы, без названий и текстов. Отправитель повторно проверяет доступ. */
export const deadlineNotifications = pgTable(
  'deadline_notifications',
  {
    id: id(),
    occurrenceId: uuid('occurrence_id')
      .notNull()
      .references(() => deadlineOccurrencesTable.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => accounts.id),
    warningAt: timestamp('warning_at', { withTimezone: true }).notNull(),
    notificationKind: text('notification_kind')
      .$type<
        | 'deadline'
        | 'readings_open'
        | 'readings_closing'
        | 'readings_last_day'
        | 'payment_upcoming'
        | 'payment_due'
        | 'verification'
      >()
      .notNull()
      .default('deadline'),
    status: text('status').notNull().default('pending'),
    cancellationReason: text('cancellation_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('deadline_notifications_once')
      .on(t.occurrenceId, t.recipientId, t.warningAt, t.notificationKind)
      .where(sql`status <> 'cancelled' OR cancellation_reason IS NOT NULL`),
    check(
      'deadline_notifications_cancellation_reason',
      sql`cancellation_reason IS NULL OR (status='cancelled' AND cancellation_reason='settings')`,
    ),
    check(
      'deadline_notifications_status',
      sql`status IN ('pending', 'sent', 'cancelled', 'summary')`,
    ),
    pgPolicy('deadline_notifications_select', {
      for: 'select',
      to: appRole,
      using: sql`recipient_id = app.current_account_id() AND EXISTS (SELECT 1 FROM deadline_occurrences o WHERE o.id = occurrence_id)`,
    }),
    ...(['select', 'insert', 'update', 'delete'] as const).map((op) =>
      pgPolicy(`deadline_notifications_worker_${op}`, {
        for: op,
        to: workerRole,
        ...(op === 'insert' ? {} : { using: sql`true` }),
        ...(['insert', 'update'].includes(op) ? { withCheck: sql`true` } : {}),
      }),
    ),
  ],
);
