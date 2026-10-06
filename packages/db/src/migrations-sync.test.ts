// Схема в коде (schema.ts, core.ts, records.ts, access-sql.ts) и миграции не расходятся: drizzle-kit,
// запущенный на копии папки миграций, не находит, что ещё создать. Иначе правка политики или колонки
// в коде осталась бы без миграции, а база в рабочем окружении — без правки.
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migrate.ts';

const run = promisify(execFile);
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

describe('миграции', () => {
  it('создают ровно то, что описано в схеме: drizzle-kit не находит расхождений', async () => {
    // Копия — внутри пакета: drizzle-kit склеивает путь --out с текущей папкой, и абсолютный путь с другого диска ломает его.
    const copy = await mkdtemp(join(PACKAGE_DIR, '.migrations-check-'));
    try {
      await cp(MIGRATIONS_DIR, copy, { recursive: true });
      const before = (await readdir(copy)).sort();
      const drizzleKit = join(PACKAGE_DIR, 'node_modules', 'drizzle-kit', 'bin.cjs');
      const { stdout } = await run(
        process.execPath,
        [
          drizzleKit,
          'generate',
          '--dialect',
          'postgresql',
          '--schema',
          './src/schema.ts',
          '--out',
          relative(PACKAGE_DIR, copy),
        ],
        { cwd: PACKAGE_DIR },
      );
      expect((await readdir(copy)).sort(), stdout).toEqual(before);
      expect(stdout).toMatch(/No schema changes/);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  }, 60_000);

  it('нумерация подряд, без пропусков: 0000, 0001, …', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
    expect(files.map((name) => name.slice(0, 4))).toEqual(
      files.map((_, index) => String(index).padStart(4, '0')),
    );
  });
});
