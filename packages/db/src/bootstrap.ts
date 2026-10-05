// Роли и база HomeCRM (ADR-0004). Выполняет суперпользователь PostgreSQL: роли — один раз
// на сервер, база — один раз. Дальше схему ведут миграции от имени homecrm_owner.
// Пароли ролей здесь не задаются: в рабочем окружении их выставит развёртывание из файла
// секретов (R0.11), а одноразовые тестовые серверы пускают без пароля.
import type { ClientBase } from 'pg';

export const DB_ROLES = {
  /** Владелец таблиц, выполняет миграции. */
  owner: 'homecrm_owner',
  /** Приложение: без BYPASSRLS и не владелец таблиц, поэтому RLS действует всегда. */
  app: 'homecrm_app',
  /** Системные задачи обработчика — с узкими отдельными политиками. */
  worker: 'homecrm_worker',
} as const;

// Ни одна роль не может обойти RLS, создавать роли и базы или стать суперпользователем.
const ROLE_ATTRIBUTES = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Создаёт роли, если их нет, и приводит их атрибуты к нужным. Повторный запуск безопасен. */
export async function createRoles(admin: ClientBase): Promise<void> {
  for (const role of Object.values(DB_ROLES)) {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role};
      END IF;
    END $$`);
    await admin.query(`ALTER ROLE ${role} ${ROLE_ATTRIBUTES}`);
  }
}

/** Создаёт базу, которой владеет homecrm_owner; подключаться к ней могут только роли HomeCRM. */
export async function createDatabase(admin: ClientBase, name: string): Promise<void> {
  if (!DATABASE_NAME.test(name)) throw new Error(`Invalid database name: ${name}`);
  await admin.query(`CREATE DATABASE ${name} OWNER ${DB_ROLES.owner}`);
  await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${DB_ROLES.app}, ${DB_ROLES.worker}`);
}
