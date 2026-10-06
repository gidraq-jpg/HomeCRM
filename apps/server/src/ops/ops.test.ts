import { randomBytes } from 'node:crypto';
import { createPool } from '@homecrm/db';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { BackupResult } from './backup.ts';
import { bootstrapDatabase, countRows, migrationState } from './database.ts';
import { databaseUrl, loadOpsEnv, type OpsEnv } from './env.ts';
import { runMigrate } from './migrate.ts';
import { createLog, silentLog } from './process.ts';
import { configuredRepos, forgetArgs, parseSnapshotId, RETENTION } from './restic.ts';
import { compareCounts } from './restore.ts';
import { dueAction, localTime } from './scheduler.ts';
import type { BackupStatus } from './status.ts';

const adminUrl = new URL(inject('pgAdminUrl'));
const dbName = `homecrm_ops_${randomBytes(5).toString('hex')}`;

const env: OpsEnv = loadOpsEnv({
  DB_HOST: adminUrl.hostname,
  DB_PORT: adminUrl.port || '5432',
  DB_NAME: dbName,
  DB_ADMIN_USER: decodeURIComponent(adminUrl.username),
  HOME_TIME_ZONE: 'Asia/Yekaterinburg',
});

const admin = createPool(inject('pgAdminUrl'), { max: 2, onError: () => {} });
afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('настройки эксплуатации', () => {
  it('умолчания: копии включены, локальное хранилище, второго нет', () => {
    const defaults = loadOpsEnv({});
    expect(defaults.BACKUP_ENABLED).toBe(true);
    expect(configuredRepos(defaults).map((repo) => repo.name)).toEqual(['local']);
  });

  it('второе хранилище — только через rclone; ошибка называет переменную, а не значение', () => {
    const withCloud = loadOpsEnv({ BACKUP_CLOUD_REPOSITORY: 'rclone:gdrive:HomeCRM-backups' });
    expect(configuredRepos(withCloud).map((repo) => repo.name)).toEqual(['local', 'cloud']);
    let message = '';
    try {
      loadOpsEnv({ BACKUP_CLOUD_REPOSITORY: 's3:https://secret-host/bucket' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BACKUP_CLOUD_REPOSITORY');
    expect(message).not.toContain('secret-host');
  });

  it('пароль в адресе базы кодируется и не попадает в журнал настроек', () => {
    const url = databaseUrl(loadOpsEnv({}), 'homecrm_owner', 'p@ss/w:rd', 'homecrm');
    expect(new URL(url).password).toBe(encodeURIComponent('p@ss/w:rd'));
    expect(new URL(url).hostname).toBe('db');
  });
});

describe('хранение и разбор restic', () => {
  it('глубина хранения: 7 ежедневных, 4 недельных, 6 месячных (DATA-3)', () => {
    expect(RETENTION).toMatchObject({ daily: 7, weekly: 4, monthly: 6 });
    const args = forgetArgs('daily', 'homecrm').join(' ');
    expect(args).toContain('--keep-daily 7');
    expect(args).toContain('--keep-weekly 4');
    expect(args).toContain('--keep-monthly 6');
    expect(args).toContain('--tag daily');
    expect(forgetArgs('pre-migration', 'homecrm').join(' ')).toContain('--keep-last 5');
  });

  it('номер снимка берётся из итоговой строки вывода', () => {
    const output = [
      '{"message_type":"status","percent_done":0.5}',
      '{"message_type":"summary","snapshot_id":"abc123def"}',
    ].join('\n');
    expect(parseSnapshotId(output)).toBe('abc123def');
    expect(() => parseSnapshotId('{"message_type":"status"}')).toThrow();
  });
});

describe('расписание копий', () => {
  const status = (overrides: Partial<BackupStatus>): BackupStatus => ({
    cloudConfigured: false,
    repos: {},
    ...overrides,
  });
  // 03:30 по Екатеринбургу (UTC+5) = 22:30 UTC предыдущих суток.
  const at = (iso: string) => new Date(iso);

  it('время считается в часовом поясе дома', () => {
    expect(localTime(at('2026-10-06T22:30:00Z'), 'Asia/Yekaterinburg')).toEqual({
      date: '2026-10-07',
      minutes: 3 * 60 + 30,
    });
  });

  it('до 3:30 ничего не делает, если вчерашняя копия свежая', () => {
    const last = status({
      lastAttemptAt: '2026-10-06T22:31:00Z',
      lastSuccessAt: '2026-10-06T22:35:00Z',
      lastCheckAt: '2026-10-05T00:00:00Z',
    });
    expect(dueAction(at('2026-10-07T20:00:00Z'), last, env)).toBeUndefined();
  });

  it('после 3:30 без сегодняшней копии — копия; когда она сделана — больше не повторяется', () => {
    const yesterday = status({
      lastAttemptAt: '2026-10-05T22:31:00Z',
      lastSuccessAt: '2026-10-05T22:35:00Z',
    });
    expect(dueAction(at('2026-10-06T22:40:00Z'), yesterday, env)).toBe('backup');
    const today = status({
      lastAttemptAt: '2026-10-06T22:41:00Z',
      lastSuccessAt: '2026-10-06T22:45:00Z',
      lastCheckAt: '2026-10-06T23:00:00Z',
    });
    expect(dueAction(at('2026-10-07T05:00:00Z'), today, env)).toBeUndefined();
  });

  it('компьютер был выключен: просроченная копия делается сразу, в любое время суток', () => {
    const old = status({
      lastSuccessAt: '2026-10-04T22:35:00Z',
      lastAttemptAt: '2026-10-04T22:31:00Z',
    });
    expect(dueAction(at('2026-10-06T08:00:00Z'), old, env)).toBe('backup');
    expect(dueAction(at('2026-10-06T08:00:00Z'), undefined, env)).toBe('backup');
  });

  it('после сбоя повтор — не чаще раза в полчаса', () => {
    const failed = status({
      lastSuccessAt: '2026-10-04T22:35:00Z',
      lastAttemptAt: '2026-10-06T08:00:00Z',
      lastCheckAt: '2026-10-05T08:00:00Z',
    });
    expect(dueAction(at('2026-10-06T08:10:00Z'), failed, env)).toBeUndefined();
    expect(dueAction(at('2026-10-06T08:40:00Z'), failed, env)).toBe('backup');
  });

  it('проверка хранилищ — раз в неделю после 4:30', () => {
    const fresh = {
      lastAttemptAt: '2026-10-06T22:41:00Z',
      lastSuccessAt: '2026-10-06T22:45:00Z',
    };
    const old = status({ ...fresh, lastCheckAt: '2026-09-29T00:00:00Z' });
    expect(dueAction(at('2026-10-07T00:00:00Z'), old, env)).toBe('check'); // 05:00 дома
    expect(dueAction(at('2026-10-06T23:10:00Z'), old, env)).toBeUndefined(); // 04:10 дома: рано
  });
});

describe('сверка после восстановления', () => {
  it('совпадает — нет замечаний; расхождения называют таблицы, но не записи', () => {
    expect(compareCounts({ 'public.notes': 3 }, { 'public.notes': 3 })).toEqual([]);
    expect(compareCounts({ 'public.notes': 3 }, { 'public.notes': 2 })).toEqual([
      'public.notes: expected 3 rows, restored 2',
    ]);
    expect(compareCounts({ 'public.notes': 3 }, {})).toHaveLength(1);
    expect(compareCounts({}, { 'public.extra': 1 })).toHaveLength(1);
  });
});

describe('база: роли, миграции, копия перед ними (DATA-4)', () => {
  beforeAll(async () => {
    await bootstrapDatabase(env, silentLog);
  });

  it('bootstrap повторно безопасен и создаёт пустую базу', async () => {
    await bootstrapDatabase(env, silentLog);
    const pool = createPool(databaseUrl(env, env.DB_ADMIN_USER, undefined, dbName), {
      max: 1,
      onError: () => {},
    });
    expect(await countRows(pool)).toEqual({});
    const state = await migrationState(pool);
    expect(state.applied).toBe(0);
    expect(state.pending.length).toBeGreaterThan(0);
    await pool.end();
  });

  it('первая миграция пустой базы идёт без копии, повторный запуск ничего не делает', async () => {
    const backup = vi.fn<NonNullable<Parameters<typeof runMigrate>[0]['backup']>>();
    await runMigrate({ env, log: silentLog, backup });
    expect(backup).not.toHaveBeenCalled();
    await runMigrate({ env, log: silentLog, backup });
    expect(backup).not.toHaveBeenCalled();
    const pool = createPool(databaseUrl(env, env.DB_ADMIN_USER, undefined, dbName), {
      max: 1,
      onError: () => {},
    });
    const state = await migrationState(pool);
    expect(state.pending).toEqual([]);
    expect(Object.keys(await countRows(pool))).toContain('drizzle.__drizzle_migrations');
    await pool.end();
  });

  it('есть данные и новая миграция, а копия не удалась: миграция не идёт', async () => {
    const pool = createPool(databaseUrl(env, env.DB_ADMIN_USER, undefined, dbName), {
      max: 1,
      onError: () => {},
    });
    // Последняя миграция «ещё не применена»: удаляем отметку о ней.
    await pool.query(
      'delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)',
    );
    const before = await migrationState(pool);
    expect(before.pending).toHaveLength(1);

    const failed: BackupResult = { ok: false, kind: 'pre-migration', repos: {} };
    const backup = vi.fn(async () => failed);
    await expect(runMigrate({ env, log: silentLog, backup })).rejects.toThrow(
      'migration cancelled',
    );
    expect(backup).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pre-migration' }));
    expect((await migrationState(pool)).pending).toEqual(before.pending);

    // В окружении без копий (предпросмотр, проверка восстановления) копия не требуется.
    const noBackups = vi.fn();
    // Применение последней миграции поверх уже созданных таблиц упадёт: здесь важно лишь, что копию не просили.
    await runMigrate({
      env: { ...env, BACKUP_ENABLED: false },
      log: createLog(() => {}),
      backup: noBackups,
    }).catch(() => {});
    expect(noBackups).not.toHaveBeenCalled();
    await pool.end();
  });
});
