import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg, { type Pool } from 'pg';
import { z } from 'zod';
import * as schema from './schema.ts';

/**
 * Пул подключений по адресу из настроек. Ошибка простаивающего соединения (перезапуск базы) не
 * должна ронять процесс: она попадает в журнал вызывающего, а пул открывает новое соединение.
 */
export function createPool(
  connectionString: string,
  options: { max?: number; onError?: (error: Error) => void } = {},
): Pool {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  pool.on('error', (error) => options.onError?.(error));
  return pool;
}

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const AccountId = z.uuid();

export interface AppDatabase {
  /**
   * Транзакция от имени учётной записи (ADR-0004). Первым запросом задаёт контекст
   * `set_config('app.account_id', id, true)`: `true` ограничивает значение этой транзакцией,
   * поэтому при пуле соединений контекст не достаётся следующему запросу.
   * Ошибка внутри `fn` откатывает транзакцию и пробрасывается дальше.
   */
  withAccount<T>(
    accountId: string,
    fn: (tx: Transaction) => Promise<T>,
    options?: { isolationLevel: 'repeatable read' },
  ): Promise<T>;
}

/**
 * База для приложения: пул подключений ролью homecrm_app. Других способов выполнить запрос
 * здесь нет намеренно: без контекста политики RLS не показывают ни одной строки.
 */
export function createAppDatabase(pool: Pool): AppDatabase {
  const db: Database = drizzle({ client: pool, schema });
  return {
    withAccount(accountId, fn, options) {
      const parsed = AccountId.safeParse(accountId);
      if (!parsed.success) {
        return Promise.reject(new TypeError('withAccount: accountId must be a UUID'));
      }
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.account_id', ${parsed.data}, true)`);
        return fn(tx);
      }, options);
    },
  };
}

/** База для обработчика: роль homecrm_worker видит только то, что разрешают её узкие политики. */
export function createWorkerDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

/**
 * База для службы входа (ADR-0005): пул ролью homecrm_auth. Роль видит таблицы входа — учётные
 * записи, сессии, пароли, приглашения — и состав домов, но не данные семьи; контекста участника
 * у неё нет. Использовать только там, где без этой роли не обойтись: Better Auth, приглашения,
 * сброс пароля. Данные семьи — только через `createAppDatabase`.
 */
export function createAuthDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}
