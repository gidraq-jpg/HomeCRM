// Матрица доступа (ADR-0004, ADR-0013): перебирает участников × места × виды записей × операции
// и сравнивает ответ базы с эталоном access.ts. База отвечает от имени роли homecrm_app,
// контекст задаёт настоящий withAccount; каждая попытка откатывается, данные не меняются.
import {
  type Audience,
  canRestore,
  canTrash,
  canView,
  canWrite,
  type Placement,
  type RecordFacts,
} from '@homecrm/shared';
import { eq, sql } from 'drizzle-orm';
import { EXPIRED_TRASH_SQL, RECORD_TYPES, type RecordType } from '../access-sql.ts';
import type { AppDatabase, Transaction } from '../client.ts';
import { RECORD_TABLES } from '../schema.ts';
import {
  type Family,
  type Person,
  placementColumns,
  type SeededRecord,
  TYPE_LABELS,
} from './family.ts';

export const OPERATIONS = [
  'view',
  'list',
  'create',
  'edit',
  'trash',
  'restore',
  'move',
  'delete',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const OPERATION_LABELS: Readonly<Record<Operation, string>> = {
  view: 'чтение записи по id',
  list: 'список без фильтра в коде',
  create: 'создание',
  edit: 'изменение',
  trash: 'удаление в корзину',
  restore: 'восстановление из корзины',
  move: 'перенос в другое место',
  delete: 'удаление мимо корзины: DELETE или дата корзины задним числом',
};

export interface MatrixReport {
  operation: Operation;
  checks: number;
  /** Сколько попыток эталон разрешает: проверка, что матрица не вырождена. */
  allowedByReference: number;
  mismatches: string[];
}

interface Attempt {
  viewer: Person;
  label: string;
  expected: boolean;
  run(tx: Transaction): Promise<boolean>;
}

/** Откат с результатом: попытка не должна ничего менять в общих данных матрицы. */
class Rollback extends Error {
  readonly allowed: boolean;
  constructor(allowed: boolean) {
    super('matrix probe rollback');
    this.allowed = allowed;
  }
}

/** 42501 insufficient_privilege: и нарушение политики RLS, и отсутствие права на таблицу. */
export function isDenied(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ((current as { code?: unknown }).code === '42501') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function probe(db: AppDatabase, attempt: Attempt): Promise<boolean> {
  try {
    await db.withAccount(attempt.viewer.id, async (tx) => {
      throw new Rollback(await attempt.run(tx));
    });
  } catch (error) {
    if (error instanceof Rollback) return error.allowed;
    if (isDenied(error)) return false;
    throw error;
  }
  throw new Error('Matrix probe finished without rollback');
}

function samePlacement(a: Placement, b: Placement): boolean {
  if (a.spaceId !== b.spaceId) return false;
  if (a.kind === 'household' && b.kind === 'household') return a.audience === b.audience;
  return true;
}

function attemptsFor(
  family: Family,
  operation: Operation,
  types: readonly RecordType[],
): Attempt[] {
  const inScope = family.records.filter((record) => types.includes(record.type));
  const live = inScope.filter((record) => !record.trashed);
  const trashed = inScope.filter((record) => record.trashed);
  const each = (
    records: readonly SeededRecord[],
    make: (viewer: Person, record: SeededRecord) => Omit<Attempt, 'viewer'>,
  ): Attempt[] =>
    family.people.flatMap((viewer) =>
      records.map((record) => ({ viewer, ...make(viewer, record) })),
    );

  switch (operation) {
    case 'view':
      return each(inScope, (viewer, record) => ({
        label: record.label,
        expected: canView(viewer.viewer, record.facts.placement),
        run: async (tx) => {
          const table = RECORD_TABLES[record.type];
          const rows = await tx.select({ id: table.id }).from(table).where(eq(table.id, record.id));
          return rows.length === 1;
        },
      }));
    case 'edit':
      return each(live, (viewer, record) => ({
        label: record.label,
        expected: canWrite(viewer.viewer, record.facts),
        run: (tx) => updateRecord(tx, record, { title: 'изменено' }),
      }));
    case 'trash':
      return each(live, (viewer, record) => ({
        label: record.label,
        expected: canTrash(viewer.viewer, record.facts),
        run: (tx) => updateRecord(tx, record, { deletedAt: new Date() }),
      }));
    case 'restore':
      return each(trashed, (viewer, record) => ({
        label: record.label,
        expected: canRestore(viewer.viewer, record.facts),
        run: (tx) => updateRecord(tx, record, { deletedAt: null }),
      }));
    case 'move':
      // access.ts не описывает перенос отдельно: изменение места — это изменение записи,
      // поэтому нужно право писать и старую запись, и новую (USING и WITH CHECK политики).
      return family.people.flatMap((viewer) =>
        live.flatMap((record) =>
          family.placements
            .filter((target) => !samePlacement(target, record.facts.placement))
            .map((target) => {
              const moved: RecordFacts = { ...record.facts, placement: target };
              return {
                viewer,
                label: `${record.label} → ${family.describe(record.type, moved)}`,
                expected: canWrite(viewer.viewer, record.facts) && canWrite(viewer.viewer, moved),
                run: (tx: Transaction) => updateRecord(tx, record, placementColumns(target)),
              };
            }),
        ),
      );
    case 'delete':
      // Удаление — только через корзину на 30 дней. Мимо неё два пути, и оба закрыты для всех:
      // DELETE (права нет ни на что) и дата корзины задним числом — запись сразу стала бы
      // просроченной и ушла бы обработчику. Дату при переносе ставит база, в корзине её не изменить.
      return each(inScope, (_viewer, record) => ({
        label: record.label,
        expected: false,
        run: async (tx) => {
          const table = RECORD_TABLES[record.type];
          const deleted = await tx
            .transaction(async (savepoint) => {
              const result = await savepoint.delete(table).where(eq(table.id, record.id));
              return result.rowCount === 1;
            })
            .catch((error: unknown) => {
              if (isDenied(error)) return false;
              throw error;
            });
          if (deleted) return true;
          const backdated = await tx
            .update(table)
            .set({ deletedAt: new Date('2000-01-01T00:00:00Z') })
            .where(eq(table.id, record.id))
            // То же условие, по которому запись видит политика очистки обработчика.
            .returning({ expired: sql<boolean>`${sql.raw(EXPIRED_TRASH_SQL)}` });
          return backdated[0]?.expired === true;
        },
      }));
    case 'create':
      return family.people.flatMap((viewer) =>
        types.flatMap((type) =>
          family.placements.flatMap((placement) =>
            family.assigneeCandidates(placement).map((assigneeId) => {
              const facts: RecordFacts = { placement, type, authorId: viewer.id, assigneeId };
              return {
                viewer,
                label: family.describe(type, facts),
                expected: canWrite(viewer.viewer, facts),
                run: async (tx: Transaction) => {
                  await tx.insert(RECORD_TABLES[type]).values({
                    ...placementColumns(placement),
                    authorId: viewer.id,
                    assigneeId,
                    title: 'новая запись',
                  });
                  return true;
                },
              };
            }),
          ),
        ),
      );
    case 'list':
      throw new Error('list is checked by listing, not by single attempts');
  }
}

async function updateRecord(
  tx: Transaction,
  record: SeededRecord,
  values: Partial<{
    title: string;
    deletedAt: Date | null;
    spaceId: string;
    spaceKind: Placement['kind'];
    audience: Audience | null;
  }>,
): Promise<boolean> {
  const table = RECORD_TABLES[record.type];
  const result = await tx.update(table).set(values).where(eq(table.id, record.id));
  return result.rowCount === 1;
}

/** «Запрос без фильтра»: всё, что вернула база, сверяется с тем, что участнику положено видеть. */
async function listMismatches(
  db: AppDatabase,
  family: Family,
  types: readonly RecordType[],
): Promise<MatrixReport> {
  const mismatches: string[] = [];
  let checks = 0;
  let allowedByReference = 0;
  for (const viewer of family.people) {
    for (const type of types) {
      const table = RECORD_TABLES[type];
      const rows = await db.withAccount(viewer.id, (tx) => tx.select({ id: table.id }).from(table));
      const visible = new Set(rows.map((row) => row.id));
      for (const record of family.records.filter((candidate) => candidate.type === type)) {
        const expected = canView(viewer.viewer, record.facts.placement);
        checks++;
        if (expected) allowedByReference++;
        if (expected !== visible.has(record.id)) {
          mismatches.push(describeMismatch(viewer, 'list', record.label, expected));
        }
      }
      if (visible.size > family.records.filter((record) => record.type === type).length) {
        mismatches.push(
          `${viewer.name} · список (${TYPE_LABELS[type]}): база вернула лишние строки`,
        );
      }
    }
  }
  return { operation: 'list', checks, allowedByReference, mismatches };
}

function describeMismatch(viewer: Person, operation: Operation, label: string, expected: boolean) {
  const answer = (value: boolean) => (value ? 'да' : 'нет');
  return `${viewer.name} · ${OPERATION_LABELS[operation]} · ${label}: эталон — ${answer(expected)}, база — ${answer(!expected)}`;
}

/** Запускает попытки параллельно: каждая в своей транзакции на своём соединении пула. */
async function runAll(attempts: readonly Attempt[], db: AppDatabase, concurrency: number) {
  const results = new Array<boolean>(attempts.length);
  let next = 0;
  const worker = async () => {
    while (next < attempts.length) {
      const index = next++;
      const attempt = attempts[index];
      if (attempt !== undefined) results[index] = await probe(db, attempt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, attempts.length) }, worker));
  return results;
}

export async function runMatrix(
  db: AppDatabase,
  family: Family,
  operation: Operation,
  types: readonly RecordType[] = RECORD_TYPES,
): Promise<MatrixReport> {
  if (operation === 'list') return listMismatches(db, family, types);
  const attempts = attemptsFor(family, operation, types);
  const results = await runAll(attempts, db, 8);
  const mismatches = attempts.flatMap((attempt, index) =>
    results[index] === attempt.expected
      ? []
      : [describeMismatch(attempt.viewer, operation, attempt.label, attempt.expected)],
  );
  return {
    operation,
    checks: attempts.length,
    allowedByReference: attempts.filter((attempt) => attempt.expected).length,
    mismatches,
  };
}
