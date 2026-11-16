// Проверка границ: пакеты, модули сервера и файлы маршрутов (ADR-0053).
// Запуск: node scripts/check-architecture.ts — входит в pnpm lint.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Import {
  /** Путь файла от корня репозитория, с прямыми косыми. */
  file: string;
  /** Что написано в from '…'. */
  target: string;
  /** import type { … } — на выполнение не влияет. */
  typeOnly: boolean;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s+['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importsOf(file: string, source: string): Import[] {
  const found: Import[] = [];
  for (const match of source.matchAll(IMPORT))
    found.push({ file, target: match[2] ?? '', typeOnly: match[1] !== undefined });
  for (const match of source.matchAll(DYNAMIC))
    found.push({ file, target: match[1] ?? '', typeOnly: false });
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.'))
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const isTest = (file: string) =>
  /\.(test|perf\.test|e2e)\.tsx?$/.test(file) || /\/(testing|e2e|eval)\//.test(file);

/** Пакет файла: apps/server, packages/db и так далее; для остального — пустая строка. */
const packageOf = (file: string) => /^(apps|packages|tools)\/[^/]+/.exec(file)?.[0] ?? '';

/** Кому разрешено зависеть от кого: shared → db → server; клиент берёт только shared. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'packages/shared': [],
  'packages/db': ['@homecrm/shared'],
  'apps/server': ['@homecrm/shared', '@homecrm/db'],
  'apps/web': ['@homecrm/shared'],
};

const SERVER = 'apps/server/src/';
/** Модуль сервера — папка первого уровня; файлы в корне (app.ts, config.ts) — каждый сам по себе. */
function serverModule(file: string): string {
  const rest = file.slice(SERVER.length);
  return rest.includes('/') ? (rest.split('/')[0] ?? rest) : rest;
}
/** Точки сборки приложения: им можно импортировать всё, в графе модулей они не участвуют. */
const COMPOSITION = new Set(['app.ts', 'main.ts', 'worker.ts', 'dev']);

function cycles(graph: Map<string, Set<string>>): string[][] {
  // Алгоритм Тарьяна: сильно связные компоненты больше одного модуля — это циклы.
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next))
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    for (;;) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    if (component.length > 1) found.push(component.sort());
  };
  for (const node of [...graph.keys()].sort()) if (!index.has(node)) visit(node);
  return found;
}

/** Возвращает список нарушений; пустой — границы соблюдены. */
export function analyze(root: string): string[] {
  const problems: string[] = [];
  const files = ['apps', 'packages', 'tools', 'scripts']
    .flatMap((dir) => {
      try {
        return walk(join(root, dir));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    })
    .map((path) => relative(root, path).split(sep).join('/'));
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const own = packageOf(file);
    const all = importsOf(file, readFileSync(join(root, file), 'utf8'));
    for (const { target, typeOnly } of all) {
      const relativeTarget = target.startsWith('.')
        ? resolve(root, dirname(file), target)
            .slice(resolve(root).length + 1)
            .split(sep)
            .join('/')
        : undefined;

      // 1. Чужой пакет — только через его имя, а не длинным путём в src. Исключение — браузерные
      // сценарии: они поднимают сервер в своём процессе, а у сервера нет входов пакета.
      const e2eServer =
        file.startsWith('apps/web/e2e/') && relativeTarget?.startsWith('apps/server/src/');
      if (relativeTarget !== undefined && packageOf(relativeTarget) !== own && !e2eServer)
        problems.push(`${file}: импорт мимо границы пакета — ${target}`);

      // 2. Направление зависимостей между пакетами (тестам базы клиент и сервер разрешены).
      const dependency = /^@homecrm\/[a-z-]+/.exec(target)?.[0];
      const allowed = ALLOWED[own];
      if (dependency && allowed && !allowed.includes(dependency) && !isTest(file))
        problems.push(`${file}: пакет ${own} не должен зависеть от ${dependency}`);

      if (!file.startsWith(SERVER) || relativeTarget === undefined || isTest(file)) continue;
      if (!relativeTarget.startsWith(SERVER)) continue;
      const from = serverModule(file);
      const to = serverModule(relativeTarget);

      // 3. Файлы маршрутов подключает только сборка приложения.
      if (/routes\.ts$/.test(relativeTarget) && !COMPOSITION.has(from))
        problems.push(`${file}: файл маршрутов импортируется не из app.ts — ${target}`);

      // 4. Граф модулей: только зависимости, которые существуют при выполнении.
      if (typeOnly || from === to || COMPOSITION.has(from)) continue;
      const edges = graph.get(from) ?? new Set<string>();
      edges.add(to);
      graph.set(from, edges);
      if (!graph.has(to)) graph.set(to, new Set());
    }
  }
  for (const cycle of cycles(graph))
    problems.push(`apps/server/src: цикл между модулями — ${cycle.join(' ↔ ')}`);
  return problems.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = analyze(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (problems.length > 0) {
    console.error(`Нарушены границы модулей (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('Границы модулей в порядке.');
}
