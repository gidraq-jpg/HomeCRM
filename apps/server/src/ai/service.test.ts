import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('AI-5: отдельный сервис Hermes не пишет содержимое и проверяет ключ, Origin и размер', async () => {
  const { stdout, stderr } = await promisify(execFile)(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      '-B',
      new URL('../../../../deploy/hermes-ai/test_server.py', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    ],
    { timeout: 30000, windowsHide: true },
  );
  expect(stdout).toBe('');
  expect(stderr).toContain('OK');
}, 30000);
