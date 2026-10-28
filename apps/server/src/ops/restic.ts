// restic: два хранилища — локальная папка и Яндекс Диск через rclone (ADR-0021, ADR-0014, ADR-0047).
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
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

/**
 * Тип подключения rclone (`yandex`, `webdav`, `local`…) из текста rclone.conf. Читается только строка
 * `type` нужной секции: логин, пароль и токен из файла никуда не передаются.
 */
export function rcloneRemoteType(config: string, remote: string): string | undefined {
  let inSection = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inSection = section[1] === remote;
      continue;
    }
    const type = inSection ? /^type\s*=\s*([A-Za-z0-9_-]+)\s*$/.exec(line) : null;
    if (type) return type[1];
  }
  return undefined;
}

/** Имя подключения rclone из адреса хранилища `rclone:<remote>:<путь>`. */
export function rcloneRemoteName(repository: string): string | undefined {
  return /^rclone:([^:]+):/.exec(repository)?.[1];
}

/**
 * Параметры rclone при работе restic. Для бэкенда `yandex` (REST API) удалённое не уходит в корзину
 * Яндекс Диска (--yandex-hard-delete). У WebDAV такого ключа нет (ADR-0047): только `serve restic`.
 */
export function rcloneOptions(remoteType: string | undefined): string[] {
  const args =
    remoteType === 'yandex' ? 'serve restic --stdio --yandex-hard-delete' : 'serve restic --stdio';
  return ['-o', `rclone.args=${args}`];
}

/**
 * Короткая причина сбоя облака по выводу restic и rclone (stderr). Вывод не копируется никогда — он
 * может цитировать имена файлов и адреса; в журнал и статус идёт только одна из фраз ниже.
 */
const CLOUD_REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b401 Unauthorized\b|\[401 -|\bstatus(?: code)?:? 401\b/i,
    'HTTP 401: login or app password rejected',
  ],
  [/\b403 Forbidden\b|\[403 -|\bstatus(?: code)?:? 403\b/i, 'HTTP 403: access forbidden'],
  [
    /\b410 Gone\b|\[410 -|\bstatus(?: code)?:? 410\b|DiskResourceGone/i,
    'HTTP 410: Yandex Disk REST API is gone, use WebDAV',
  ],
  [
    /\b507 Insufficient Storage\b|\[507 -|DiskNotEnoughSpace|\bquota exceeded\b/i,
    'HTTP 507: cloud storage is full',
  ],
  [/\b429 Too Many Requests\b|\[429 -|\bstatus(?: code)?:? 429\b/i, 'HTTP 429: too many requests'],
  [
    /\bno such host\b|\bconnection refused\b|\bnetwork is unreachable\b|\bi\/o timeout\b|\bTLS handshake timeout\b|\bconnection reset by peer\b/i,
    'network error: cloud is unreachable',
  ],
];

export function cloudFailureReason(output: string): string | undefined {
  for (const [pattern, reason] of CLOUD_REASONS) {
    if (pattern.test(output)) return reason;
  }
  return undefined;
}

/** Команды, которые передают или перебирают весь снимок: им нужен тайм-аут копии, а не служебный. */
const LONG_COMMANDS: ReadonlySet<string> = new Set([
  'backup',
  'restore',
  'forget',
  'prune',
  'check',
]);

/** Тайм-аут команды restic в миллисекундах: только для облака. restic сам повторяет запросы до 15 минут. */
export function resticTimeoutMs(env: OpsEnv, repo: Repo, command: string): number | undefined {
  if (repo.name !== 'cloud') return undefined;
  return (
    1000 *
    (LONG_COMMANDS.has(command)
      ? env.BACKUP_CLOUD_BACKUP_TIMEOUT_SECONDS
      : env.BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS)
  );
}

/** Выполняет команду restic; ненулевой код — ошибка с безопасной причиной (без вывода программы). */
export type Restic = (
  args: string[],
  options?: { allowCodes?: number[] },
) => Promise<{ code: number; stdout: string }>;

export async function resticFor(env: OpsEnv, repo: Repo): Promise<Restic> {
  const resticEnvironment = await resticEnv(env, repo);
  const remote = rcloneRemoteName(repo.repository);
  const remoteType =
    remote === undefined || resticEnvironment.RCLONE_CONFIG === undefined
      ? undefined
      : rcloneRemoteType(await readFile(resticEnvironment.RCLONE_CONFIG, 'utf8'), remote);
  const rclone = rcloneOptions(remoteType);
  return async (args, options = {}) => {
    const command = args[0] ?? 'command';
    const timeoutMs = resticTimeoutMs(env, repo, command);
    const result = await run('restic', [...rclone, ...args], {
      env: resticEnvironment,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const reason = repo.name === 'cloud' ? cloudFailureReason(result.stderr) : undefined;
    if (result.timedOut) {
      throw new OpsError(
        `cloud timeout at ${command} after ${Math.round((timeoutMs ?? 0) / 1000)} s${reason === undefined ? '' : `: ${reason}`}`,
      );
    }
    if (result.code !== 0 && !(options.allowCodes ?? []).includes(result.code)) {
      throw commandFailure('restic', command, result.code, reason ?? RESTIC_HINTS[result.code]);
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
