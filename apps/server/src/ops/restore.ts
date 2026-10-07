// Восстановление из копии и проверка восстановления (DATA-3, ADR-0021).
// Только в пустую базу: поверх живых данных восстановление не идёт. Проверка делается в отдельном
// compose-проекте `homecrm-restore-check`, который скрипт поднимает и удаляет сам.
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { countFiles, DUMP_FILE, MANIFEST_FILE, type Manifest } from './backup.ts';
import { bootstrapDatabase, connectAdmin, countRows, type RowCounts } from './database.ts';
import { type OpsEnv, pgEnv } from './env.ts';
import { runMigrate } from './migrate.ts';
import { commandFailure, errorMessage, type Log, OpsError, run } from './process.ts';
import { latestSnapshot, type RepoName, repoByName, resticFor } from './restic.ts';
import { type RestoreCheckStatus, restoreCheckFile, writeStatus } from './status.ts';

const RESTORE_DIR = '/tmp/homecrm-restore';

export interface RestoreOptions {
  env: OpsEnv;
  log: Log;
  from: RepoName;
  /** Номер снимка или `latest`. */
  snapshot: string;
  /** Проверка: файлы не копируются в рабочую папку, итог записывается в статус. */
  check: boolean;
  /** После восстановления применить миграции текущей версии (проверка выпуска на копии). */
  migrate: boolean;
  /** Каталог для распаковки; в тестах — временный. */
  workDir?: string;
}

export interface RestoreReport {
  ok: boolean;
  snapshot: string;
  snapshotTime?: string;
  tables: number;
  rows: number;
  files: number;
  mismatches: string[];
  migrated: boolean;
}

async function findFile(root: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) return join(entry.parentPath, entry.name);
  }
  return undefined;
}

/** Сравнение числа строк «после восстановления» с тем, что записано в снимке. */
export function compareCounts(expected: RowCounts, actual: RowCounts): string[] {
  const problems: string[] = [];
  for (const [table, count] of Object.entries(expected)) {
    const got = actual[table];
    if (got === undefined) problems.push(`${table}: table is missing after restore`);
    else if (got !== count) problems.push(`${table}: expected ${count} rows, restored ${got}`);
  }
  for (const table of Object.keys(actual)) {
    if (!(table in expected)) problems.push(`${table}: unexpected table after restore`);
  }
  return problems;
}

export async function runRestore(options: RestoreOptions): Promise<RestoreReport> {
  const { env, log } = options;
  const work = options.workDir ?? RESTORE_DIR;
  const started = Date.now();
  let report: RestoreReport | undefined;
  let failure: unknown;
  let snapshotTime: string | undefined;
  let snapshotId = options.snapshot;
  try {
    await bootstrapDatabase(env, log);
    const pool = await connectAdmin(env, env.DB_NAME, log);
    try {
      const existing = await countRows(pool);
      if (Object.keys(existing).length > 0) {
        throw new OpsError(
          `The target database is not empty (${Object.keys(existing).length} tables): restore is only into an empty database`,
        );
      }
    } finally {
      await pool.end();
    }

    const restic = await resticFor(env, repoByName(env, options.from));
    const latest = await latestSnapshot(restic, env.BACKUP_HOST);
    if (latest === undefined) throw new OpsError('The repository has no snapshots');
    if (options.snapshot === 'latest') snapshotId = latest.id;
    snapshotTime = latest.id === snapshotId ? latest.time : undefined;
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    await restic(['restore', snapshotId, '--target', work]);
    log.info('snapshot unpacked', { snapshot: snapshotId });

    const dump = await findFile(work, DUMP_FILE);
    const manifestFile = await findFile(work, MANIFEST_FILE);
    if (dump === undefined || manifestFile === undefined) {
      throw new OpsError('The snapshot has no dump or manifest');
    }
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;

    const restored = await run(
      'pg_restore',
      ['--exit-on-error', '--single-transaction', '--no-password', `--dbname=${env.DB_NAME}`, dump],
      { env: pgEnv(env, env.DB_NAME) },
    );
    if (restored.code !== 0) {
      throw commandFailure('pg_restore', 'restore', restored.code);
    }

    const after = await connectAdmin(env, env.DB_NAME, log);
    let counts: RowCounts;
    try {
      counts = await countRows(after);
    } finally {
      await after.end();
    }
    const mismatches = compareCounts(manifest.tables, counts);

    // Файлы лежат в снимке по пути папки файлов; в проверке их достаточно пересчитать.
    const filesRoot =
      manifest.version === 2 ? join(dirname(manifestFile), 'files') : join(work, env.FILES_DIR);
    const restoredFiles = await countFiles(filesRoot);
    if (restoredFiles !== manifest.files) {
      mismatches.push(`files: expected ${manifest.files}, restored ${restoredFiles}`);
    }
    if (!options.check && restoredFiles > 0) {
      await cp(filesRoot, env.FILES_DIR, { recursive: true });
    }

    let migrated = false;
    if (options.migrate && mismatches.length === 0) {
      // Восстановление копий не делает: ни перед этой миграцией, ни вообще.
      await runMigrate({ env: { ...env, BACKUP_ENABLED: false }, log });
      migrated = true;
    }
    report = {
      ok: mismatches.length === 0,
      snapshot: snapshotId,
      ...(snapshotTime === undefined ? {} : { snapshotTime }),
      tables: Object.keys(counts).length,
      rows: Object.values(counts).reduce((sum, value) => sum + value, 0),
      files: restoredFiles,
      mismatches,
      migrated,
    };
    log.info(report.ok ? 'restore verified' : 'restore does not match the snapshot', {
      tables: report.tables,
      rows: report.rows,
      mismatches,
    });
  } catch (error) {
    failure = error;
    log.error('restore failed', { error: errorMessage(error) });
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  if (options.check) {
    const status: RestoreCheckStatus = {
      at: new Date().toISOString(),
      ok: report?.ok === true,
      repository: options.from,
      snapshot: snapshotId,
      ...(snapshotTime === undefined ? {} : { snapshotTime }),
      tables: report?.tables ?? 0,
      rows: report?.rows ?? 0,
      files: report?.files ?? 0,
      mismatches: report?.mismatches ?? [],
      migrated: report?.migrated ?? false,
      durationSec: Math.round((Date.now() - started) / 1000),
      ...(failure === undefined ? {} : { error: errorMessage(failure) }),
    };
    await writeStatus(env.BACKUP_STATUS_DIR, restoreCheckFile(options.from), status);
  }
  if (failure !== undefined) throw failure;
  if (report === undefined) throw new OpsError('restore produced no report');
  return report;
}
