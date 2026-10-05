// Глобальная подготовка тестов пакета db: один сервер PostgreSQL 18 на прогон и роли HomeCRM на нём.
// Каждый файл тестов затем создаёт себе отдельную базу со случайным именем (database.ts).
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createRoles } from '../bootstrap.ts';
import { startPostgres } from './postgres.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Подключение суперпользователя к одноразовому серверу PostgreSQL. */
    pgAdminUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startPostgres();
  try {
    const admin = new pg.Client({ connectionString: server.adminUrl });
    await admin.connect();
    try {
      await createRoles(admin);
    } finally {
      await admin.end();
    }
  } catch (error) {
    await server.stop();
    throw error;
  }
  project.provide('pgAdminUrl', server.adminUrl);
  return server.stop;
}
