import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Пустой или неизвестный набор требует полной проверки; снимки всегда считаются кодом. */
export function documentsOnly(files: readonly string[]): boolean {
  return (
    files.length > 0 &&
    files.every(
      (file) =>
        !file.startsWith('docs/screenshots/') && (file.endsWith('.md') || file.startsWith('docs/')),
    )
  );
}

const git = (args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function changedFiles(base: string, head: string): string[] {
  // Без распознавания переименований: проверяются оба пути, в том числе удалённый исходный код.
  return git(['diff', '--name-only', '--no-renames', '-z', base, head, '--'])
    .split('\0')
    .filter(Boolean);
}

export function pushedFiles(input: string): string[] {
  const updates = input.trim().split('\n').filter(Boolean);
  if (updates.length === 0) throw new Error('No pushed refs');
  return updates.flatMap((line) => {
    const [localRef, head, remoteRef, remoteHead] = line.trim().split(/\s+/);
    if (
      !localRef?.startsWith('refs/heads/') ||
      !remoteRef?.startsWith('refs/heads/') ||
      !head ||
      !remoteHead ||
      /^0+$/.test(head)
    ) {
      throw new Error('Unknown or deleted pushed ref');
    }
    const base = /^0+$/.test(remoteHead)
      ? git(['merge-base', 'origin/main', head]).trim()
      : remoteHead;
    return changedFiles(base, head);
  });
}

function pnpm(args: string[]) {
  // pnpm.cmd нужен cmd.exe на Windows; аргументы — только наши константы.
  const windows = process.platform === 'win32';
  const result = spawnSync(
    windows ? 'cmd.exe' : 'pnpm',
    windows ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args,
    {
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Минимальный формат Markdown, который Biome не поддерживает. Удалённые файлы не читаем. */
export function markdownProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.includes('\r')) problems.push('нужны переводы строк LF');
  if (text && !text.endsWith('\n')) problems.push('нет перевода строки в конце файла');
  if (text.split('\n').some((line) => /[\t ]+$/.test(line)))
    problems.push('пробелы в конце строки');
  return problems;
}

function checkDocuments(files: string[]) {
  const existing = [...new Set(files)].filter((file) => existsSync(file));
  const problems = existing
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) =>
      markdownProblems(readFileSync(file, 'utf8')).map((problem) => `${file}: ${problem}`),
    );
  if (problems.length) throw new Error(problems.join('\n'));
  // Пути передаются через stdin: имена с пробелами и метасимволами не попадают в командную строку.
  for (const file of existing.filter((file) => !file.endsWith('.md'))) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/@biomejs/biome/bin/biome', import.meta.url)),
        'format',
        '--no-errors-on-unmatched',
        `--stdin-file-path=${file}`,
      ],
      {
        input: readFileSync(file),
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);
    if (result.stdout && result.stdout !== readFileSync(file, 'utf8'))
      throw new Error(`${file}: запустите pnpm format`);
  }
  console.log(`Формат документов в порядке (${existing.length}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'ci') {
    let onlyDocs = false;
    try {
      const [base, head] = process.argv.slice(3);
      if (base && head) onlyDocs = documentsOnly(changedFiles(base, head));
    } catch {
      console.log('База сравнения неизвестна: полный прогон.');
    }
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${onlyDocs}\n`);
    console.log(onlyDocs ? 'Только документы: кодировка и формат.' : 'Полный прогон проверок.');
  } else if (mode === 'pre-push' || mode === 'docs') {
    let files: string[] = [];
    try {
      files =
        mode === 'pre-push'
          ? pushedFiles(readFileSync(0, 'utf8'))
          : changedFiles(process.argv[3] ?? '', process.argv[4] ?? 'HEAD');
    } catch {
      console.log('База сравнения неизвестна: полный прогон.');
    }
    if (documentsOnly(files)) {
      console.log('Только документы: кодировка и формат.');
      pnpm(['check:encoding']);
      checkDocuments(files);
    } else {
      if (mode === 'docs') throw new Error('Ожидались только документы');
      const result = spawnSync(process.execPath, ['--test', 'scripts/select-checks.test.ts'], {
        stdio: 'inherit',
      });
      if (result.status !== 0) process.exit(result.status ?? 1);
      pnpm(['check']);
    }
  } else {
    throw new Error('Expected pre-push, ci or docs');
  }
}
