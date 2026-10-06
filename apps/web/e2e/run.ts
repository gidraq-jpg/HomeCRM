import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { E2E_PREFIX } from './support/static-server.ts';

const require = createRequire(import.meta.url);
process.env.WEB_BASE = E2E_PREFIX;
async function run(file: string, args: string[]) {
  const code = await new Promise<number>((done, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (status) => done(status ?? 1));
  });
  if (code !== 0) process.exit(code);
}
await run(resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build']);
await run(require.resolve('@playwright/test/cli'), [
  'test',
  ...(process.argv[2] === 'auth' ? ['e2e/auth', ...process.argv.slice(3)] : process.argv.slice(2)),
]);
