import { sql } from 'drizzle-orm';
import { bigint, check, jsonb, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { canExportHouseSql } from './access-sql.ts';
import { accounts, appRole, createdAt, id, spaces } from './core.ts';

/** DATA-2: неизменяемая отметка подготовки архива, без содержимого записей. */
export const exportEvents = pgTable(
  'export_events',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    kind: text('kind').$type<'personal' | 'household'>().notNull(),
    householdId: uuid('household_id').references(() => spaces.id),
    createdAt: createdAt(),
    counts: jsonb('counts').$type<Record<string, number>>().notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  },
  () => [
    check(
      'export_events_scope',
      sql`(kind='personal' AND household_id IS NULL) OR (kind='household' AND household_id IS NOT NULL)`,
    ),
    check('export_events_counts', sql`jsonb_typeof(counts)='object' AND size_bytes>=0`),
    pgPolicy('export_events_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(
        `(kind='personal' AND account_id=app.current_account_id()) OR (kind='household' AND ${canExportHouseSql('household_id')})`,
      ),
    }),
    pgPolicy('export_events_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql.raw(
        `account_id=app.current_account_id() AND (kind='personal' OR ${canExportHouseSql('household_id')})`,
      ),
    }),
  ],
);
