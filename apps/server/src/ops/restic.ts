// restic: два хранилища — локальная папка и Яндекс Диск через rclone (ADR-0021, ADR-0014).
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OpsEnv } from './env.ts';
import { commandFailure, OpsError, run } from './process.ts';

export type RepoName = 'local' | 'cloud';

export interface Repo {
  name: RepoName;
  repository: string;
}

/** Глубина хранения ежедневных копий (DATA-3): 7 ежедневных, 4 недельных, 6 месячных. */
export const RETENTION = { daily: 7, weekly: 4, monthly: 6, preMigration: 5 } as const;

/** Папка копии внутри контейнера, куда rclone кладёт обновлённый токен: исходный файл только для чтения. */
const RCLONE_WORKING_CONFIG = '/tmp/homecrm-rclone/rclone.conf';

/** Хранилища, настроенные в этом окружении. Локальное есть всегда; облачное — если задан адрес. */
export function configuredRepos(env: OpsEnv): Repo[] {
  const repos: Repo[] = [{ name: 'local', repository: env.BACKUP_LOCAL_REPOSITORY }];
  if (env.BACKUP_CLOUD_REPOSITORY !== undefined) {
    repos.push({ name: 'cloud', repository: env.BACKUP_CLOUD_REPOSITORY });
  }
  return repos;
}

export function repoByName(env: OpsEnv, name: RepoName): Repo {
  const repo = configuredRepos(env).find((candidate) => candidate.name === name);
  if (repo === undefined) throw new OpsError(`Repository "${name}" is not configured`);
  return repo;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Окружение для запуска restic. Для хранилища на Яндекс Диске rclone читает копию конфигурации
 * из /tmp: при обновлении токена он пишет в неё, а не в файл, смонтированный только для чтения.
 */
export async function resticEnv(env: OpsEnv, repo: Repo): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    RESTIC_REPOSITORY: repo.repository,
    RESTIC_PASSWORD_FILE: env.RESTIC_PASSWORD_FILE,
    RESTIC_CACHE_DIR: '/tmp/restic-cache',
  };
  if (repo.repository.startsWith('rclone:')) {
    if (!(await exists(env.RCLONE_CONFIG_SOURCE))) {
      throw new OpsError('rclone configuration is missing: connect Yandex Disk (docs/runbook.md)');
    }
    await mkdir(dirname(RCLONE_WORKING_CONFIG), { recursive: true });
    await copyFile(env.RCLONE_CONFIG_SOURCE, RCLONE_WORKING_CONFIG);
    result.RCLONE_CONFIG = RCLONE_WORKING_CONFIG;
  }
  return result;
}

/** Коды выхода restic, по которым причина известна без его вывода (вывод restic может цитировать имена файлов). */
const RESTIC_HINTS: Readonly<Record<number, string>> = {
  3: 'some files could not be read',
  10: 'repository does not exist',
  11: 'repository is locked',
  12: 'wrong repository password',
};

/** Параметры rclone при работе restic: удалённое не уходит в корзину Яндекс Диска и не съедает объём (--yandex-hard-delete). */
const RCLONE_OPTIONS = ['-o', 'rclone.args=serve restic --stdio --yandex-hard-delete'];

/** Выполняет команду restic; ненулевой код — ошибка с хвостом вывода (без секретов). */
export type Restic = (
  args: string[],
  options?: { allowCodes?: number[] },
) => Promise<{ code: number; stdout: string }>;

export async function resticFor(env: OpsEnv, repo: Repo): Promise<Restic> {
  const resticEnvironment = await resticEnv(env, repo);
  return async (args, options = {}) => {
    const result = await run('restic', [...RCLONE_OPTIONS, ...args], { env: resticEnvironment });
    if (result.code !== 0 && !(options.allowCodes ?? []).includes(result.code)) {
      throw commandFailure('restic', args[0] ?? 'command', result.code, RESTIC_HINTS[result.code]);
    }
    return { code: result.code, stdout: result.stdout };
  };
}

/** Создаёт хранилище, если его ещё нет (restic завершается кодом 10, когда репозитория нет). */
export async function ensureRepo(restic: Restic): Promise<boolean> {
  const config = await restic(['cat', 'config'], { allowCodes: [10] });
  if (config.code === 0) return false;
  await restic(['init']);
  return true;
}

export function forgetArgs(kind: 'daily' | 'pre-migration', host: string): string[] {
  const base = ['forget', '--prune', '--host', host, '--tag', kind];
  return kind === 'daily'
    ? [
        ...base,
        '--keep-daily',
        String(RETENTION.daily),
        '--keep-weekly',
        String(RETENTION.weekly),
        '--keep-monthly',
        String(RETENTION.monthly),
      ]
    : [...base, '--keep-last', String(RETENTION.preMigration)];
}

/** Номер снимка из вывода `restic backup --json`. */
export function parseSnapshotId(output: string): string {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    try {
      const message = JSON.parse(line) as { message_type?: string; snapshot_id?: string };
      if (message.message_type === 'summary' && message.snapshot_id) return message.snapshot_id;
    } catch {
      // Не строка JSON — пропускаем.
    }
  }
  throw new OpsError('restic did not report a snapshot id');
}

export interface SnapshotInfo {
  id: string;
  time: string;
}

export async function latestSnapshot(
  restic: Restic,
  host: string,
): Promise<SnapshotInfo | undefined> {
  const { stdout } = await restic(['snapshots', '--json', '--host', host]);
  const list = JSON.parse(stdout || '[]') as Array<{ short_id: string; time: string }>;
  const last = [...list].sort((a, b) => a.time.localeCompare(b.time)).at(-1);
  return last === undefined ? undefined : { id: last.short_id, time: last.time };
}
