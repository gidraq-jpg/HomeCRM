// Резервная копия (DATA-3, DATA-4, ADR-0021): дамп базы и файлы — в каждое настроенное хранилище.
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectAdmin, countRows, type RowCounts } from './database.ts';
import { type OpsEnv, pgEnv } from './env.ts';
import { commandFailure, errorMessage, type Log, OpsError, run } from './process.ts';
import {
  configuredRepos,
  ensureRepo,
  forgetArgs,
  parseSnapshotId,
  type Repo,
  resticFor,
} from './restic.ts';
import {
  BACKUP_STATUS_FILE,
  type BackupStatus,
  type RepoResult,
  readStatus,
  writeStatus,
} from './status.ts';

export type BackupKind = 'daily' | 'pre-migration';

export const DUMP_FILE = 'homecrm.dump';
export const MANIFEST_FILE = 'manifest.json';

/** Что лежит в снимке рядом с дампом: по этим числам проверка восстановления сверяет базу. */
export interface Manifest {
  version: 1 | 2;
  createdAt: string;
  kind: BackupKind;
  appVersion: string;
  database: string;
  /** Число строк по таблицам на момент дампа. */
  tables: RowCounts;
  /** Число файлов в папке файлов приложения. */
  files: number;
}

export interface BackupResult {
  ok: boolean;
  kind: BackupKind;
  repos: Partial<Record<'local' | 'cloud', RepoResult>>;
}

export async function countFiles(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) total++;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw new OpsError('File backup directory is unreadable');
  }
  return total;
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    await readdir(dir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new OpsError('File backup directory is unreadable');
  }
}

/** Блоки снимка копируются до освобождения общей блокировки с GC. */
export async function stageFileBlocks(
  source: string,
  target: string,
  requiredKeys: readonly string[],
) {
  await mkdir(target, { recursive: true });
  try {
    if (await directoryExists(source)) await cp(source, target, { recursive: true });
    for (const key of requiredKeys) {
      if (!/^[0-9a-f-]{36}$/i.test(key) || !(await stat(join(target, key))).isFile())
        throw new Error('missing');
    }
  } catch {
    throw new OpsError('File backup staging failed: a required block is missing or unreadable');
  }
}

/**
 * Дамп базы со снимком: число строк и дамп относятся к одному моменту, даже если приложение
 * пишет в базу во время копии. Затем дамп проверяется на читаемость.
 */
export async function dumpDatabase(
  env: OpsEnv,
  kind: BackupKind,
  stage: string,
  log: Log,
): Promise<Manifest> {
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const pool = await connectAdmin(env, env.DB_NAME, log);
  const client = await pool.connect();
  let tables: RowCounts;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))",
    );
    const snapshot = (await client.query<{ id: string }>('select pg_export_snapshot() as id'))
      .rows[0]?.id;
    if (snapshot === undefined) throw new OpsError('database did not export a snapshot');
    tables = await countRows(client);
    // Без сжатия pg_dump: restic сжимает и дедуплицирует сам, а несжатый дамп дедуплицируется лучше.
    const dump = await run(
      'pg_dump',
      [
        '--format=custom',
        '--compress=0',
        '--no-password',
        `--snapshot=${snapshot}`,
        `--file=${join(stage, DUMP_FILE)}`,
      ],
      { env: pgEnv(env, env.DB_NAME) },
    );
    if (dump.code !== 0) throw commandFailure('pg_dump', 'dump', dump.code);
    const hasRegistry = (
      await client.query("SELECT to_regclass('public.file_blobs') IS NOT NULL AS present")
    ).rows[0].present;
    const keys = hasRegistry
      ? (await client.query<{ key: string }>('SELECT key FROM file_blobs')).rows.map(
          (row) => row.key,
        )
      : [];
    await stageFileBlocks(env.FILES_DIR, join(stage, 'files'), keys);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  const listing = await run('pg_restore', ['--list', join(stage, DUMP_FILE)]);
  if (listing.code !== 0) {
    throw commandFailure('pg_restore', 'dump check', listing.code);
  }
  const manifest: Manifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    kind,
    appVersion: env.APP_VERSION,
    database: env.DB_NAME,
    tables,
    files: await countFiles(join(stage, 'files')),
  };
  await writeFile(join(stage, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function backupToRepo(
  env: OpsEnv,
  repo: Repo,
  kind: BackupKind,
  stage: string,
  log: Log,
): Promise<string> {
  const restic = await resticFor(env, repo);
  if (await ensureRepo(restic)) log.info('repository created', { repository: repo.name });
  const paths = [stage];
  const { stdout } = await restic([
    'backup',
    '--json',
    '--host',
    env.BACKUP_HOST,
    '--tag',
    kind,
    '--tag',
    'homecrm',
    ...paths,
  ]);
  const snapshot = parseSnapshotId(stdout);
  try {
    await restic(forgetArgs(kind, env.BACKUP_HOST));
  } catch (error) {
    // Копия уже сохранена; сбой очистки старых копий не должен превращать её в неудачную.
    log.warn('retention cleanup failed', { repository: repo.name, error: errorMessage(error) });
  }
  return snapshot;
}

/**
 * Делает копию во все настроенные хранилища. Сбой одного не останавливает другое: результат по
 * каждому записывается в статус. `ok` — копия удалась везде, где она нужна.
 */
export async function runBackup(opts: {
  env: OpsEnv;
  kind: BackupKind;
  log: Log;
}): Promise<BackupResult> {
  const { env, kind, log } = opts;
  const stage = env.BACKUP_STAGE_DIR;
  const startedAt = new Date().toISOString();
  const previous = await readStatus<BackupStatus>(env.BACKUP_STATUS_DIR, BACKUP_STATUS_FILE);
  const repos = configuredRepos(env);
  const results: BackupResult['repos'] = {};
  log.info('backup started', { kind });
  try {
    const manifest = await dumpDatabase(env, kind, stage, log);
    log.info('dump ready', { tables: Object.keys(manifest.tables).length, files: manifest.files });
    for (const repo of repos) {
      try {
        const snapshot = await backupToRepo(env, repo, kind, stage, log);
        results[repo.name] = { ok: true, at: new Date().toISOString(), snapshot };
        log.info('backup saved', { repository: repo.name, snapshot });
      } catch (error) {
        results[repo.name] = {
          ok: false,
          at: new Date().toISOString(),
          error: errorMessage(error),
        };
        log.error('backup failed', { repository: repo.name, error: errorMessage(error) });
      }
    }
  } catch (error) {
    for (const repo of repos) {
      results[repo.name] = { ok: false, at: startedAt, error: errorMessage(error) };
    }
    log.error('dump failed', { error: errorMessage(error) });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }

  // Для копии перед миграцией облако можно явно пропустить (выпуск без интернета).
  const needed = repos.filter(
    (repo) =>
      !(
        kind === 'pre-migration' &&
        repo.name === 'cloud' &&
        env.BACKUP_PRE_MIGRATION_CLOUD === 'skip'
      ),
  );
  const ok = needed.every((repo) => results[repo.name]?.ok === true);
  const status: BackupStatus = {
    cloudConfigured: env.BACKUP_CLOUD_REPOSITORY !== undefined,
    lastAttemptAt: startedAt,
    ...(ok
      ? { lastSuccessAt: new Date().toISOString() }
      : previous?.lastSuccessAt
        ? { lastSuccessAt: previous.lastSuccessAt }
        : {}),
    lastKind: kind,
    repos: results,
    ...(previous?.lastCheckAt ? { lastCheckAt: previous.lastCheckAt } : {}),
    ...(previous?.lastCheckOk === undefined ? {} : { lastCheckOk: previous.lastCheckOk }),
  };
  await writeStatus(env.BACKUP_STATUS_DIR, BACKUP_STATUS_FILE, status);
  return { ok, kind, repos: results };
}

/** Проверка целостности хранилищ (раз в неделю). */
export async function checkRepositories(env: OpsEnv, log: Log): Promise<boolean> {
  let allOk = true;
  for (const repo of configuredRepos(env)) {
    try {
      const restic = await resticFor(env, repo);
      await restic(['check']);
      log.info('repository check passed', { repository: repo.name });
    } catch (error) {
      allOk = false;
      log.error('repository check failed', { repository: repo.name, error: errorMessage(error) });
    }
  }
  const status = await readStatus<BackupStatus>(env.BACKUP_STATUS_DIR, BACKUP_STATUS_FILE);
  await writeStatus(env.BACKUP_STATUS_DIR, BACKUP_STATUS_FILE, {
    cloudConfigured: env.BACKUP_CLOUD_REPOSITORY !== undefined,
    repos: {},
    ...status,
    lastCheckAt: new Date().toISOString(),
    lastCheckOk: allOk,
  });
  return allOk;
}
