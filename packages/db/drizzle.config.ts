// drizzle-kit создаёт SQL-миграции из src/schema.ts (ADR-0003). Подключение к базе ему не нужно.
// То, чего drizzle-kit не умеет (функции, триггеры, FORCE ROW LEVEL SECURITY, права ролей), —
// в своих миграциях: `pnpm --filter @homecrm/db exec drizzle-kit generate --custom --name=<имя>`.
// Таблица записей пользователя: recordTable() в schema.ts и `SELECT app.attach_record_table('имя')`
// в миграции после CREATE TABLE (src/records.ts, ADR-0004). migrations-sync.test.ts следит,
// чтобы схема в коде и миграции не расходились.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
