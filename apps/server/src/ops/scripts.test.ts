import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { run } from './process.ts';

it('команды копирования, восстановления и состояния завершают ожидание первой базы', async () => {
  const script = fileURLToPath(
    new URL('../../../../deploy/test/first-database.ps1', import.meta.url),
  );
  const result = await run('pwsh', ['-NoProfile', '-File', script], { timeoutMs: 90_000 });
  expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout.match(/ок:/g), result.stdout).toHaveLength(5);
  expect(result.stdout + result.stderr).not.toContain('fictional-test-only');
}, 100_000);
