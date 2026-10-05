// drizzle-kit создаёт SQL-миграции из src/schema.ts (ADR-0003). Подключение к базе ему не нужно.
// То, чего drizzle-kit не умеет (функции, FORCE ROW LEVEL SECURITY, права ролей), —
// в своих миграциях: `pnpm --filter @homecrm/db exec drizzle-kit generate --custom --name=<имя>`.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
