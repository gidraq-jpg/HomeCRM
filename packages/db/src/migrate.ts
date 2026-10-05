import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { DB_ROLES } from './bootstrap.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Применяет миграции одной транзакцией. Подключение — только ролью homecrm_owner:
 * от суперпользователя таблицы получили бы другого владельца, и права ролей разошлись бы с ADR-0004.
 */
export async function runMigrations(ownerPool: Pool): Promise<void> {
  const { rows } = await ownerPool.query<{ user: string }>('SELECT current_user AS user');
  const user = rows[0]?.user;
  if (user !== DB_ROLES.owner) {
    throw new Error(`Migrations must run as ${DB_ROLES.owner}, connected as ${user ?? 'unknown'}`);
  }
  await migrate(drizzle({ client: ownerPool }), { migrationsFolder: MIGRATIONS_DIR });
}
