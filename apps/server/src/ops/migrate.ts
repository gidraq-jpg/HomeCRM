// Миграции при запуске окружения (ADR-0015) и копия перед ними (DATA-4, ADR-0020).
import { createPool, DB_ROLES, runMigrations } from '@homecrm/db';
import { type BackupResult, runBackup } from './backup.ts';
import { bootstrapDatabase, migrationState } from './database.ts';
import { databaseUrl, type OpsEnv } from './env.ts';
import type { Log } from './process.ts';

export interface MigrateOptions {
  env: OpsEnv;
  log: Log;
  /** Подменяется в тестах. */
  backup?: (opts: { env: OpsEnv; kind: 'pre-migration'; log: Log }) => Promise<BackupResult>;
}

/**
 * Готовит базу и применяет миграции. Если в базе уже есть данные и есть миграции, меняющие схему,
 * сначала делается копия; без удачной копии миграция не идёт и окружение не запускается.
 */
export async function runMigrate(options: MigrateOptions): Promise<void> {
  const { env, log } = options;
  const backup = options.backup ?? runBackup;
  await bootstrapDatabase(env, log);
  const owner = createPool(
    databaseUrl(env, DB_ROLES.owner, env.HOMECRM_OWNER_PASSWORD, env.DB_NAME),
    { max: 1, onError: () => {} },
  );
  try {
    const state = await migrationState(owner);
    if (state.pending.length === 0) {
      log.info('no pending migrations', { applied: state.applied });
      return;
    }
    log.info('pending migrations', { applied: state.applied, pending: state.pending });
    if (state.applied > 0) {
      if (!env.BACKUP_ENABLED) {
        log.warn('backups are disabled in this environment: migrating without a copy');
      } else {
        const result = await backup({ env, kind: 'pre-migration', log });
        if (!result.ok) {
          throw new Error('The copy before the migration failed: migration cancelled');
        }
        log.info('copy before the migration saved');
      }
    }
    await runMigrations(owner);
    log.info('migrations applied', { count: state.pending.length });
  } finally {
    await owner.end();
  }
}
