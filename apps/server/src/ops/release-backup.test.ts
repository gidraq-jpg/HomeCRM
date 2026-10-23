import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runBackup } from './backup.ts';
import { loadOpsEnv, type OpsEnv } from './env.ts';
import { OpsError, run, silentLog } from './process.ts';
import { resticFor } from './restic.ts';

const fixture = vi.hoisted(() => ({ script: '', command: '', heartbeat: '' }));
vi.mock('./process.ts', async (original) => {
  const actual = await original<typeof import('./process.ts')>();
  return {
    ...actual,
    run: vi.fn(async (command, args, options) => {
      if (command === 'restic') {
        return actual.run(process.execPath, [fixture.script, ...args], {
          ...options,
          env: {
            ...options?.env,
            FAKE_HANG_COMMAND: fixture.command,
            FAKE_HEARTBEAT: fixture.heartbeat,
          },
        });
      }
      return { code: 0, stdout: '', stderr: '' };
    }),
  };
});
vi.mock('./database.ts', () => ({
  countRows: async () => ({}),
  connectAdmin: async () => ({
    connect: async () => ({
      query: async () => ({ rows: [{ id: 'snapshot', present: false }] }),
      release() {},
    }),
    end: async () => {},
  }),
}));

let dir: string;
let env: OpsEnv;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'homecrm-release-backup-'));
  fixture.script = join(dir, 'restic.cjs');
  fixture.heartbeat = join(dir, 'heartbeat');
  fixture.command = 'cat';
  await writeFile(
    fixture.script,
    `
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_HEARTBEAT + '.calls', process.env.RESTIC_REPOSITORY + ' ' + args.join(' ') + '\\n');
if (process.env.RESTIC_REPOSITORY === 'cloud-fixture' && args.includes(process.env.FAKE_HANG_COMMAND)) {
  spawn(process.execPath, ['-e', 'setInterval(() => require("node:fs").appendFileSync(process.env.FAKE_HEARTBEAT, "x"), 50)'], { stdio: 'inherit' });
  console.error('fictional-secret-must-not-appear');
  setInterval(() => {}, 1000);
} else if (args.includes('backup')) {
  console.log(JSON.stringify({ message_type: 'summary', snapshot_id: 'test-snapshot' }));
}
`,
  );
  env = {
    ...loadOpsEnv({}),
    BACKUP_CLOUD_REPOSITORY: 'cloud-fixture',
    BACKUP_LOCAL_REPOSITORY: 'local-fixture',
    BACKUP_STATUS_DIR: join(dir, 'status'),
    BACKUP_STAGE_DIR: join(dir, 'stage'),
    FILES_DIR: join(dir, 'files'),
    BACKUP_CLOUD_BACKUP_TIMEOUT_SECONDS: 1,
    BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS: 1,
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it.each(['cat', 'backup', 'forget', 'check', 'snapshots', 'restore', 'init'])(
  'облачный %s ограничен по времени и завершает дочерний процесс',
  async (command) => {
    fixture.command = command;
    const restic = await resticFor(env, { name: 'cloud', repository: 'cloud-fixture' });
    const start = Date.now();
    await expect(restic([command])).rejects.toThrow('cloud timeout');
    expect(Date.now() - start).toBeLessThan(5000);
    const heartbeat = await readFile(fixture.heartbeat, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await readFile(fixture.heartbeat, 'utf8')).toBe(heartbeat);
  },
);

it('skip не вызывает облако, но сохраняет локальную копию и явный статус', async () => {
  env.BACKUP_PRE_MIGRATION_CLOUD = 'skip';
  env.BACKUP_CLOUD_REPOSITORY = 'rclone:missing:fixture';
  env.RCLONE_CONFIG_SOURCE = join(dir, 'missing-rclone.conf');
  const result = await runBackup({ env, kind: 'pre-migration', log: silentLog });
  expect(result).toMatchObject({
    ok: true,
    repos: {
      local: { ok: true, snapshot: 'test-snapshot' },
      cloud: { ok: false, skipped: 'configuration' },
    },
  });
  const calls = await readFile(`${fixture.heartbeat}.calls`, 'utf8');
  expect(calls).toContain('local-fixture');
  expect(calls).not.toContain('cloud-fixture');
  expect(await readFile(join(env.BACKUP_STATUS_DIR, 'backup.json'), 'utf8')).toContain(
    'configuration',
  );
});

it('required: тайм-аут облака отклоняет копию перед миграцией, сохраняя локальную', async () => {
  const result = await runBackup({ env, kind: 'pre-migration', log: silentLog });
  expect(result).toMatchObject({
    ok: false,
    repos: { local: { ok: true }, cloud: { ok: false, error: 'cloud timeout' } },
  });
  expect(JSON.stringify(result)).not.toContain('fictional-secret');
});

it('skip не отключает облако для ежедневной копии', async () => {
  env.BACKUP_PRE_MIGRATION_CLOUD = 'skip';
  expect((await runBackup({ env, kind: 'daily', log: silentLog })).ok).toBe(false);
  expect(await readFile(`${fixture.heartbeat}.calls`, 'utf8')).toContain('cloud-fixture');
});

it('skip не разрешает миграцию при ошибке локальной копии', async () => {
  env.BACKUP_PRE_MIGRATION_CLOUD = 'skip';
  vi.mocked(run).mockRejectedValueOnce(new OpsError('dump failed'));
  expect(await runBackup({ env, kind: 'pre-migration', log: silentLog })).toMatchObject({
    ok: false,
    repos: { local: { ok: false, error: 'dump failed' }, cloud: { skipped: 'configuration' } },
  });
});

it('тайм-ауты имеют безопасные умолчания и проверяются без раскрытия значений', () => {
  expect(loadOpsEnv({})).toMatchObject({
    BACKUP_CLOUD_BACKUP_TIMEOUT_SECONDS: 900,
    BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS: 120,
  });
  expect(() => loadOpsEnv({ BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS: '0' })).toThrow(
    'BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS',
  );
});
