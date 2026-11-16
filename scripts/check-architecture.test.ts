import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze, importsOf } from './check-architecture.ts';

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'homecrm-architecture-'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}
function check(files: Record<string, string>): string[] {
  const root = repository(files);
  try {
    return analyze(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('разбор импортов: значения, типы, многострочные и динамические', () => {
  const found = importsOf(
    'a.ts',
    "import { a } from './a.ts';\nimport type { B } from './b.ts';\nimport {\n  c,\n  type D,\n} from './c.ts';\nexport * from './d.ts';\nconst e = await import('./e.ts');\n",
  );
  assert.deepEqual(
    found.map(({ target, typeOnly }) => [target, typeOnly]),
    [
      ['./a.ts', false],
      ['./b.ts', true],
      ['./c.ts', false],
      ['./d.ts', false],
      ['./e.ts', false],
    ],
  );
});

test('текущий репозиторий соблюдает границы', () => {
  assert.deepEqual(analyze(resolve(dirname(fileURLToPath(import.meta.url)), '..')), []);
});

test('цикл между модулями сервера ловится, импорт типов — нет', () => {
  const base = {
    'apps/server/src/notes/service.ts':
      "import { b } from '../tasks/service.ts';\nexport const a = b;\n",
  };
  assert.deepEqual(
    check({
      ...base,
      'apps/server/src/tasks/service.ts':
        "import { a } from '../notes/service.ts';\nexport const b = a;\n",
    }),
    ['apps/server/src: цикл между модулями — notes ↔ tasks'],
  );
  assert.deepEqual(
    check({
      ...base,
      'apps/server/src/tasks/service.ts':
        "import type { a } from '../notes/service.ts';\nexport const b: typeof a = 1;\n",
    }),
    [],
  );
});

test('файл маршрутов подключает только сборка приложения', () => {
  const routes = { 'apps/server/src/notes/routes.ts': 'export const notesRoutes = 1;\n' };
  assert.deepEqual(
    check({
      ...routes,
      'apps/server/src/app.ts':
        "import { notesRoutes } from './notes/routes.ts';\nexport default notesRoutes;\n",
    }),
    [],
  );
  assert.deepEqual(
    check({
      ...routes,
      'apps/server/src/tasks/service.ts':
        "import type { notesRoutes } from '../notes/routes.ts';\nexport type T = typeof notesRoutes;\n",
    }),
    [
      'apps/server/src/tasks/service.ts: файл маршрутов импортируется не из app.ts — ../notes/routes.ts',
    ],
  );
});

test('чужой пакет — только по имени и только в разрешённую сторону', () => {
  assert.deepEqual(
    check({
      'packages/db/src/index.ts': 'export const db = 1;\n',
      'apps/server/src/notes/service.ts':
        "import { db } from '../../../../packages/db/src/index.ts';\nexport const a = db;\n",
      'packages/shared/src/index.ts': "import { db } from '@homecrm/db';\nexport const s = db;\n",
      'apps/web/src/main.ts': "import { db } from '@homecrm/db';\nexport const w = db;\n",
      'apps/web/e2e/support.ts':
        "import { a } from '../../server/src/notes/service.ts';\nimport { db } from '@homecrm/db';\nexport const e = [a, db];\n",
    }),
    [
      'apps/server/src/notes/service.ts: импорт мимо границы пакета — ../../../../packages/db/src/index.ts',
      'apps/web/src/main.ts: пакет apps/web не должен зависеть от @homecrm/db',
      'packages/shared/src/index.ts: пакет packages/shared не должен зависеть от @homecrm/db',
    ],
  );
});
