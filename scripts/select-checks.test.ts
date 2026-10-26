import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { changedFiles, documentsOnly, markdownProblems, pushedFiles } from './select-checks.ts';

test('только документы: пустой список, смешанный набор, инструкции и исключение снимков', () => {
  assert.equal(documentsOnly([]), false);
  assert.equal(documentsOnly(['README.md', 'CHANGELOG.md', 'AGENTS.md', 'CLAUDE.md']), true);
  assert.equal(documentsOnly(['docs/adr/0019.md', 'docs/diagram.svg']), true);
  assert.equal(documentsOnly(['README.md', 'apps/server/src/app.ts']), false);
  assert.equal(documentsOnly(['docs/screenshots/screen.png']), false);
  assert.equal(documentsOnly(['docs/screenshots/README.md']), false);
  assert.equal(documentsOnly(['docs-other/file.json']), false);
});

test('формат Markdown: LF, конец файла и пробелы', () => {
  assert.deepEqual(markdownProblems('# Документ\n\nТекст.\n'), []);
  assert.deepEqual(markdownProblems(''), []);
  assert.equal(markdownProblems('Текст.\r\n').length, 1);
  assert.equal(markdownProblems('Текст.').length, 1);
  assert.equal(markdownProblems('Текст. \n').length, 1);
  assert.equal(markdownProblems('Текст.\t\n').length, 1);
});

test('git: переименования, удаления, новая ветка, несколько refs и неизвестная база', () => {
  mkdirSync('test-results', { recursive: true });
  const root = mkdtempSync(resolve('test-results/d31-'));
  const original = process.cwd();
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(resolve(root, 'source.ts'), 'export const value = 1;\n');
    writeFileSync(resolve(root, 'obsolete.md'), '# Старый документ\n');
    const base = commit();
    git('update-ref', 'refs/remotes/origin/main', base);
    git('mv', 'source.ts', 'renamed.md');
    const renamed = commit();
    process.chdir(root);
    assert.deepEqual(changedFiles(base, renamed).sort(), ['renamed.md', 'source.ts']);
    assert.equal(documentsOnly(changedFiles(base, renamed)), false);
    process.chdir(original);
    git('reset', '--hard', base);
    git('mv', 'obsolete.md', 'renamed.md');
    const docs = commit();
    process.chdir(root);
    assert.equal(documentsOnly(changedFiles(base, docs)), true);
    const update = `refs/heads/task ${docs} refs/heads/task ${base}\n`;
    assert.equal(documentsOnly(pushedFiles(update)), true);
    assert.equal(
      documentsOnly(pushedFiles(`refs/heads/new ${docs} refs/heads/new ${'0'.repeat(40)}\n`)),
      true,
    );
    assert.equal(
      documentsOnly(pushedFiles(`${update}refs/heads/code ${renamed} refs/heads/code ${base}\n`)),
      false,
    );
    assert.throws(() => pushedFiles(''));
    assert.throws(() => pushedFiles(`refs/heads/task ${docs} refs/heads/task ${'f'.repeat(40)}\n`));
    assert.throws(() => pushedFiles(`(delete) ${'0'.repeat(40)} refs/heads/task ${docs}\n`));
    process.chdir(original);
    git('rm', 'renamed.md');
    const deleted = commit();
    process.chdir(root);
    assert.deepEqual(changedFiles(docs, deleted), ['renamed.md']);
    assert.equal(documentsOnly(changedFiles(docs, deleted)), true);
    assert.equal(documentsOnly(changedFiles(base, base)), false);
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
