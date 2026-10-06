// Отметки о резервных копиях и проверках восстановления: небольшие JSON-файлы в папке
// E:\HomeCRM-data\backups\status. Секретов в них нет: время, номера снимков, имена таблиц, причины сбоев.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RepoResult {
  ok: boolean;
  at: string;
  snapshot?: string;
  error?: string;
}

export interface BackupStatus {
  cloudConfigured: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastKind?: 'daily' | 'pre-migration';
  repos: Partial<Record<'local' | 'cloud', RepoResult>>;
  lastCheckAt?: string;
  lastCheckOk?: boolean;
}

export interface RestoreCheckStatus {
  at: string;
  ok: boolean;
  repository: 'local' | 'cloud';
  snapshot: string;
  snapshotTime?: string;
  tables: number;
  rows: number;
  files: number;
  mismatches: string[];
  migrated: boolean;
  durationSec: number;
  error?: string;
}

export const BACKUP_STATUS_FILE = 'backup.json';
/** Результат проверки восстановления — отдельный файл на каждое хранилище. */
export const restoreCheckFile = (repository: 'local' | 'cloud'): string =>
  `restore-check-${repository}.json`;

export async function readStatus<T>(dir: string, file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, file), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Запись через временный файл: при сбое посередине остаётся прежний статус, а не обрывок. */
export async function writeStatus(dir: string, file: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, file);
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}
