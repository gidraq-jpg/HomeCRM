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

export const deadlineVisibleSql = `app.deadline_source_allowed(note_id, object_id, false)`;
export const deadlineWritableSql = `app.deadline_source_allowed(note_id, object_id, true)`;
export const deadlineCascadeSql = `pg_trigger_depth() > 0 AND coalesce(note_id,object_id) = nullif(current_setting('app.deadline_source_id',true),'')::uuid`;
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
    pgPolicy('deadlines_update', {
      for: 'update',
      to: appRole,
      using: sql.raw(`(${deadlineWritableSql}) OR (${deadlineCascadeSql})`),
      withCheck: sql.raw(`(${deadlineWritableSql}) OR (${deadlineCascadeSql})`),
    }),
    pgPolicy('deadlines_engine', { for: 'select', to: workerRole, using: sql`true` }),
    pgPolicy('deadlines_purge', {
      for: 'delete',
      to: workerRole,
      using: sql`deleted_at < now() - interval '30 days'`,
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
      using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.id = deadline_id AND ((deadline_occurrences.deleted_at IS NULL AND d.deleted_at IS NULL AND NOT d.needs_refresh AND (deadline_occurrences.time_zone = (SELECT s.time_zone FROM spaces s WHERE s.id=d.household_id) OR (d.space_kind='personal' AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=d.household_id)))) OR (pg_trigger_depth() > 0 AND d.id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid)))`,
    }),
    // Метаданные меняются только из каскада родителя, прямых прав на действия радара пока нет.
    pgPolicy('deadline_occurrences_cascade', {
      for: 'update',
      to: appRole,
      using: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
      withCheck: sql`pg_trigger_depth() > 0 AND deadline_id = nullif(current_setting('app.deadline_cascade_id',true),'')::uuid`,
    }),
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
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('deadline_notifications_once').on(t.occurrenceId, t.recipientId, t.warningAt),
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
