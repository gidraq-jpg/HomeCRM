// Очистка служебных записей входа обработчиком (роль homecrm_worker, ADR-0005): просроченные
// сессии и одноразовые значения, давние счётчики, принятые и просроченные приглашения, старый
// журнал входов. Что считать «можно убрать», решает схема (CLEANUP_CONDITIONS, schema.ts): то же
// условие стоит и в политике базы, поэтому ошибка здесь не удалит живого.
import { CLEANUP_CONDITIONS, type Database, sql } from '@homecrm/db';

/** Сколько строк убрано из каждой таблицы. Названий и содержимого записей здесь нет. */
export type CleanupReport = Record<string, number>;

export async function cleanupExpired(db: Database): Promise<CleanupReport> {
  const report: CleanupReport = {};
  const reassigned = await db.execute<{ moved: number }>(
    sql`SELECT app.reassign_responsibility() AS moved`,
  );
  report.reassigned = reassigned.rows[0]?.moved ?? 0;
  for (const [table, condition] of Object.entries(CLEANUP_CONDITIONS)) {
    // Имена таблиц и условия — из нашей схемы, не от пользователя.
    const result = await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(condition)}`);
    report[table] = result.rowCount ?? 0;
  }
  return report;
}

/** Периодический запуск: сбой одного прохода пишется в журнал и не останавливает следующие. */
export function scheduleCleanup(
  db: Database,
  log: {
    info: (data: CleanupReport, message: string) => void;
    error: (error: unknown, message: string) => void;
  },
  everyMs = 60 * 60 * 1000,
): () => void {
  const run = (): void => {
    cleanupExpired(db).then(
      (report) => log.info(report, 'sign-in cleanup finished'),
      (error: unknown) => log.error(error, 'sign-in cleanup failed'),
    );
  };
  const timer = setInterval(run, everyMs);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
