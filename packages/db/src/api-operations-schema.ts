import { sql } from 'drizzle-orm';
import { check, jsonb, pgPolicy, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { accounts, appRole, createdAt } from './core.ts';

/** Только хэш запроса и UUID результата: содержимое файла и денежные данные здесь не хранятся. */
export const apiOperations = pgTable(
  'api_operations',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    key: uuid('key').notNull(),
    operation: text('operation').notNull(),
    fingerprint: text('fingerprint').notNull(),
    resultIds: jsonb('result_ids').$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.key] }),
    check(
      'api_operations_operation',
      sql`operation IN ('contact_import','charge','payment','task_create','task_patch','task_status')`,
    ),
    check('api_operations_fingerprint', sql`fingerprint ~ '^[a-f0-9]{64}$'`),
    pgPolicy('api_operations_select', {
      for: 'select',
      to: appRole,
      using: sql`account_id=app.current_account_id()`,
    }),
    pgPolicy('api_operations_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`account_id=app.current_account_id()`,
    }),
  ],
);
