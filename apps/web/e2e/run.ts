import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { E2E_PREFIX } from './support/static-server.ts';

// `node e2e/run.ts [app|auth|prototype|all|full|full-compose] [аргументы Playwright]`
// - app (он же auth: так зовёт CI): рабочее приложение с настоящим сервером и PostgreSQL;
// - prototype: прототип навигации на вымышленных данных (отдельная сборка);
// - all (по умолчанию): сначала приложение, затем прототип.
// - full: приложение, прототип и полная матрица UI-7; full-compose запускает это в Linux.
const require = createRequire(import.meta.url);
process.env.WEB_BASE = E2E_PREFIX;
async function runCommand(command: string, args: string[], env = process.env) {
  const code = await new Promise<number>((done, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (status) => done(status ?? 1));
  });
  if (code !== 0) throw new Error(`Test command failed (exit code ${code})`);
}
const run = (file: string, args: string[], env = process.env) =>
  runCommand(process.execPath, [file, ...args], env);

if (process.argv[2] === 'full-compose') {
  const compose = [
    'compose',
    '-p',
    'homecrm-test-full',
    '-f',
    resolve(import.meta.dirname, 'fullscreen-forms/compose.yaml'),
  ];
  process.env.HOMECRM_E2E_IMAGE = 'homecrm-test-full:e2e-linux';
  process.env.UI7_PHASE = 'after';
  try {
    await runCommand('docker', [
      ...compose,
      'run',
      '--build',
      '--rm',
      'playwright',
      'pnpm',
      '--filter',
      '@homecrm/web',
      'test:e2e',
      'full',
      ...process.argv.slice(3),
    ]);
  } finally {
    await runCommand('docker', [...compose, 'down', '--volumes']);
  }
  process.exit(0);
}
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const playwright = require.resolve('@playwright/test/cli');

const modes = ['app', 'auth', 'prototype', 'all', 'full'];
const first = process.argv[2] ?? '';
const mode = modes.includes(first) ? first : 'all';
const rest = process.argv.slice(modes.includes(first) ? 3 : 2);
// Коллаж Studio 2 читает снимки w360: этот файл целиком идёт в первой части,
// сначала w360, затем w412. Остальные тесты по-прежнему делит Playwright.
const studioShard =
  process.env.HOMECRM_E2E_GROUP_STUDIO === '1'
    ? rest.find((arg) => /^--shard=\d+\/\d+$/.test(arg))
    : undefined;

if (mode !== 'prototype') {
  await run(vite, ['build']);
  await run(
    playwright,
    ['test', ...rest, ...(mode === 'full' ? ['--output=test-results/artifacts/app'] : [])],
    studioShard ? { ...process.env, HOMECRM_E2E_SHARD_MAIN: '1' } : process.env,
  );
  if (studioShard?.startsWith('--shard=1/')) {
    for (const project of ['w360', 'w412']) {
      await run(playwright, [
        'test',
        ...rest.filter((arg) => arg !== studioShard),
        'app/studio2.e2e.ts',
        `--project=${project}`,
        `--output=test-results/artifacts/studio2-${project}`,
      ]);
    }
  }
  if (mode === 'full') {
    await run(playwright, [
      'test',
      '-c',
      'e2e/fullscreen-forms/playwright.config.ts',
      ...rest,
      '--output=test-results/artifacts/forms',
    ]);
  }
}
if (mode === 'prototype' || mode === 'all' || mode === 'full') {
  await run(vite, ['build', '--mode', 'prototype']);
  await run(playwright, [
    'test',
    '-c',
    'playwright.prototype.config.ts',
    ...rest,
    ...(mode === 'full' ? ['--output=test-results/artifacts/prototype'] : []),
  ]);
}
