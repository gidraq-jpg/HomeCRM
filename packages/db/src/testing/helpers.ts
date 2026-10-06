// Помощники точечных тестов: вымышленная семья без записей и короткие действия от имени участника.
// Данные записываются от суперпользователя (он обходит RLS), а проверяемые действия — настоящим
// приложением (withAccount, роль homecrm_app), обработчиком или службой входа.
import type { Placement } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createAppDatabase, type Transaction } from '../client.ts';
import type { TestDatabase } from './database.ts';
import { buildFamily, type Family, type Person, type PersonKey, seedPeople } from './family.ts';

export interface Scene {
  database: TestDatabase;
  family: Family;
  /** Действие от имени участника под RLS: транзакция с контекстом (ADR-0004). */
  as<T>(who: PersonKey, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  person(key: PersonKey): Person;
  /** «Дом», аудитория «Вся семья» или «Взрослые». */
  home(audience: 'household' | 'adults'): Placement;
  /** «Соседи», аудитория «Вся семья» или «Взрослые». */
  neighbours(audience: 'household' | 'adults'): Placement;
  personal(who: PersonKey): Placement;
}

/** Семья без записей: учётные записи, личные пространства, два дома. */
export async function createScene(database: TestDatabase): Promise<Scene> {
  const family = buildFamily();
  await seedPeople(database.admin, family);
  const app = createAppDatabase(database.app);
  const [home, neighbours] = family.houses;
  if (home === undefined || neighbours === undefined)
    throw new Error('The family needs two houses');
  const house = (id: string, audience: 'household' | 'adults'): Placement => ({
    kind: 'household',
    spaceId: id,
    audience,
  });
  return {
    database,
    family,
    as: (who, fn) => app.withAccount(family.person(who).id, fn),
    person: (key) => family.person(key),
    home: (audience) => house(home.id, audience),
    neighbours: (audience) => house(neighbours.id, audience),
    personal: (who) => ({
      kind: 'personal',
      spaceId: family.person(who).personalSpaceId,
      ownerId: family.person(who).id,
    }),
  };
}

export interface NoteSeed {
  author: Person;
  placement: Placement;
  title?: string;
  assigneeId?: string | null;
  /** Записать сразу в корзину, давно или недавно. */
  trashedDaysAgo?: number;
}

/** Записывает заметку от суперпользователя: триггеры работают, RLS — нет. Возвращает id. */
export async function addNote(admin: pg.Pool, seed: NoteSeed): Promise<string> {
  const { placement } = seed;
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO notes (space_id, space_kind, audience, author_id, assignee_id, title, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(days => $7::int) END)
     RETURNING id`,
    [
      placement.spaceId,
      placement.kind,
      placement.kind === 'household' ? placement.audience : null,
      seed.author.id,
      seed.assigneeId ?? null,
      seed.title ?? 'заметка для проверки',
      seed.trashedDaysAgo ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('addNote: no row returned');
  return id;
}

/** Запрос от суперпользователя, который возвращает строки: проверить, что записала база. */
export async function rowsOf<T extends Record<string, unknown>>(
  admin: pg.Pool,
  query: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await admin.query<T>(query, values)).rows;
}

/** Текст ошибки PostgreSQL вместе с причинами, в которые её заворачивает Drizzle. */
export function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const { message, code } = current as { message?: unknown; code?: unknown };
    if (typeof code === 'string') parts.push(`${code}: ${String(message)}`);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

export { sql };
