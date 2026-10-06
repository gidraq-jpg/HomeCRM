import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { E2E_PREFIX } from './support/static-server.ts';

// `node e2e/run.ts [app|auth|prototype|all] [аргументы Playwright]`
// - app (он же auth: так зовёт CI): рабочее приложение с настоящим сервером и PostgreSQL;
// - prototype: прототип навигации на вымышленных данных (отдельная сборка);
// - all (по умолчанию): сначала приложение, затем прототип.
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
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const playwright = require.resolve('@playwright/test/cli');

const modes = ['app', 'auth', 'prototype', 'all'];
const first = process.argv[2] ?? '';
const mode = modes.includes(first) ? first : 'all';
const rest = process.argv.slice(modes.includes(first) ? 3 : 2);

if (mode !== 'prototype') {
  await run(vite, ['build']);
  await run(playwright, ['test', ...rest]);
}
if (mode === 'prototype' || mode === 'all') {
  await run(vite, ['build', '--mode', 'prototype']);
  await run(playwright, ['test', '-c', 'playwright.prototype.config.ts', ...rest]);
}
