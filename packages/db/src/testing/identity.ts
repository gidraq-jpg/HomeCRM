// Матрица правил входа (ADR-0005): участники × дома × действия, ответ базы против эталона access.ts.
// Та же идея, что у матрицы записей (matrix.ts), для правил, которые не про записи пользователя:
// кто может приглашать (canInvite), кому можно сбросить пароль (canResetPassword), чей журнал
// входов и отметку о сбросе видно (canViewAccountJournal).
import { randomBytes, randomUUID } from 'node:crypto';
import {
  canExclude,
  canInvite,
  canLeave,
  canResetPassword,
  canViewAccountJournal,
  ROLES,
  type Role,
  type Viewer,
} from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { createAppDatabase, type Transaction } from '../client.ts';
import type { TestDatabase } from './database.ts';
import type { Family } from './family.ts';
import { isDenied } from './matrix.ts';

export interface IdentityPerson {
  name: string;
  id: string;
  viewer: Viewer;
}

export interface IdentityWorld {
  people: readonly IdentityPerson[];
  houses: ReadonlyArray<{ id: string; name: string }>;
}

export const IDENTITY_OPERATIONS = [
  'invite-create',
  'invite-view',
  'invite-revoke',
  'reset-record',
  'journal-view',
  'notice-view',
  'member-leave',
  'member-exclude',
] as const;
export type IdentityOperation = (typeof IDENTITY_OPERATIONS)[number];

export const IDENTITY_LABELS: Readonly<Record<IdentityOperation, string>> = {
  'invite-create': 'создать приглашение',
  'invite-view': 'увидеть приглашения дома',
  'invite-revoke': 'отозвать приглашение',
  'reset-record': 'записать сброс пароля',
  'journal-view': 'прочитать журнал входов',
  'notice-view': 'прочитать отметку о сбросе',
  'member-leave': 'покинуть дом',
  'member-exclude': 'исключить участника из дома',
};

/**
 * К семье из family.ts добавляется Ян — ребёнок только в доме соседей. Мила, ребёнок в одном доме и
 * взрослая в другом (её пароль сбросить нельзя нигде), уже в семье. Запись — от имени суперпользователя:
 * он обходит RLS.
 */
export async function buildIdentityWorld(
  database: TestDatabase,
  family: Family,
): Promise<IdentityWorld> {
  const [home, neighbours] = family.houses;
  if (home === undefined || neighbours === undefined)
    throw new Error('The family needs two houses');
  const extra: Array<{ name: string; memberships: Array<[string, Role]> }> = [
    { name: 'Ян', memberships: [[neighbours.id, 'child']] },
  ];
  const people: IdentityPerson[] = family.people.map((person) => ({
    name: person.name,
    id: person.id,
    viewer: person.viewer,
  }));
  for (const { name, memberships } of extra) {
    const id = randomUUID();
    const client = await database.admin.connect();
    try {
      // Личное пространство — в той же транзакции: без него учётную запись база не примет (SPACE-1).
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO accounts (id, display_name, email, username) VALUES ($1, $2, $3, $4)`,
        [id, name, `${id}@family.invalid`, id],
      );
      await client.query(
        `INSERT INTO spaces (kind, name, owner_account_id) VALUES ('personal', $1, $2)`,
        [`Личное: ${name}`, id],
      );
      for (const [houseId, role] of memberships) {
        await client.query(
          `INSERT INTO space_members (space_id, account_id, role) VALUES ($1, $2, $3)`,
          [houseId, id, role],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    people.push({ name, id, viewer: { accountId: id, memberships: new Map(memberships) } });
  }
  return {
    people,
    houses: [
      { id: home.id, name: home.name },
      { id: neighbours.id, name: neighbours.name },
    ],
  };
}
/** Прячет в приглашениях, журнале и отметках по одной строке на дом и на человека — всё остальное матрица пробует и откатывает. */
export async function seedIdentityRows(
  database: TestDatabase,
  world: IdentityWorld,
): Promise<void> {
  const [creator] = world.people;
  if (creator === undefined) throw new Error('No people');
  for (const house of world.houses) {
    await database.admin.query(
      `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ($1, 'adult', $2, $3)`,
      [house.id, randomBytes(16).toString('hex'), creator.id],
    );
  }
  for (const person of world.people) {
    await database.auth.query(
      `INSERT INTO login_events (account_id, kind, outcome) VALUES ($1, 'sign_in', 'success')`,
      [person.id],
    );
    // Сброс выполнен: отметку человек увидит. Записываем от суперпользователя, минуя правило «только ребёнку».
    await database.admin.query(
      `INSERT INTO password_resets (account_id, requested_by, expires_at, completed_at)
       VALUES ($1, $2, now() + interval '1 day', now())`,
      [person.id, world.people.find((other) => other.id !== person.id)?.id],
    );
  }
}

export interface IdentityReport {
  operation: IdentityOperation;
  checks: number;
  /** Сколько попыток эталон разрешает: проверка, что матрица не вырождена. */
  allowedByReference: number;
  mismatches: string[];
}

/** Откат с результатом: попытка не должна ничего менять в данных матрицы. */
class Rollback extends Error {
  readonly allowed: boolean;
  constructor(allowed: boolean) {
    super('identity probe rollback');
    this.allowed = allowed;
  }
}

function deniedByDatabase(error: unknown): boolean {
  if (isDenied(error)) return true;
  // Нарушение CHECK тоже отказ: например, «сбросить пароль самому себе».
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ((current as { code?: unknown }).code === '23514') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

interface Attempt {
  label: string;
  expected: boolean;
  run(): Promise<boolean>;
}

export async function runIdentityMatrix(
  database: TestDatabase,
  world: IdentityWorld,
  operation: IdentityOperation,
): Promise<IdentityReport> {
  const app = createAppDatabase(database.app);
  const answer = (value: boolean) => (value ? 'да' : 'нет');
  const asApp = async (person: IdentityPerson, body: (tx: Transaction) => Promise<boolean>) => {
    try {
      await app.withAccount(person.id, async (tx) => {
        throw new Rollback(await body(tx));
      });
    } catch (error) {
      if (error instanceof Rollback) return error.allowed;
      if (deniedByDatabase(error)) return false;
      throw error;
    }
    throw new Error('Identity probe finished without rollback');
  };

  const attempts: Attempt[] = [];
  switch (operation) {
    case 'invite-create':
      for (const person of world.people) {
        for (const house of world.houses) {
          for (const role of ROLES) {
            attempts.push({
              label: `${person.name} → ${house.name}, роль ${role}`,
              expected: canInvite(person.viewer, house.id),
              run: () =>
                asApp(person, async (tx) => {
                  await tx.execute(sql`INSERT INTO invitations (household_id, role, token_hash, created_by)
                    VALUES (${house.id}, ${role}, ${randomBytes(16).toString('hex')}, ${person.id})`);
                  return true;
                }),
            });
          }
        }
      }
      break;
    case 'invite-view':
      for (const person of world.people) {
        for (const house of world.houses) {
          attempts.push({
            label: `${person.name} · приглашения ${house.name}`,
            expected: canInvite(person.viewer, house.id),
            run: () =>
              asApp(person, async (tx) => {
                const { rows } = await tx.execute(
                  sql`SELECT id FROM invitations WHERE household_id = ${house.id}`,
                );
                return rows.length > 0;
              }),
          });
        }
      }
      break;
    case 'invite-revoke':
      for (const person of world.people) {
        for (const house of world.houses) {
          attempts.push({
            label: `${person.name} · приглашение ${house.name}`,
            expected: canInvite(person.viewer, house.id),
            run: () =>
              asApp(person, async (tx) => {
                const result = await tx.execute(
                  sql`UPDATE invitations SET revoked_at = now() WHERE household_id = ${house.id}`,
                );
                return (result.rowCount ?? 0) > 0;
              }),
          });
        }
      }
      break;
    case 'reset-record':
      // Службе входа контекст не задаётся: правило проверяет сама политика по полю requested_by.
      for (const requester of world.people) {
        for (const target of world.people) {
          attempts.push({
            label: `${requester.name} → пароль ${target.name}`,
            expected: canResetPassword(requester.viewer, target.viewer),
            run: async () => {
              const client = await database.auth.connect();
              try {
                await client.query('BEGIN');
                await client.query(
                  `INSERT INTO password_resets (account_id, requested_by, expires_at)
                   VALUES ($1, $2, now() + interval '1 day')`,
                  [target.id, requester.id],
                );
                return true;
              } catch (error) {
                if (deniedByDatabase(error)) return false;
                throw error;
              } finally {
                await client.query('ROLLBACK');
                client.release();
              }
            },
          });
        }
      }
      break;
    case 'member-leave':
    case 'member-exclude': {
      // Уход и исключение записывает служба входа; кто это делает — в left_by, правило проверяет политика
      // и триггер (последний администратор). Попытка откатывается: состав дома матрицы не меняется.
      const adminIds = (houseId: string) =>
        world.people
          .filter((person) => person.viewer.memberships.get(houseId) === 'admin')
          .map((person) => person.id);
      const end = async (houseId: string, accountId: string, by: string): Promise<boolean> => {
        const client = await database.auth.connect();
        try {
          await client.query('BEGIN');
          const result = await client.query(
            `UPDATE space_members SET left_at = now(), left_by = $3 WHERE space_id = $1 AND account_id = $2`,
            [houseId, accountId, by],
          );
          return (result.rowCount ?? 0) > 0;
        } catch (error) {
          if (deniedByDatabase(error)) return false;
          throw error;
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      };
      for (const house of world.houses) {
        for (const person of world.people) {
          if (operation === 'member-leave') {
            attempts.push({
              label: `${person.name} · ${house.name}`,
              expected: canLeave(person.viewer, house.id, adminIds(house.id)),
              run: () => end(house.id, person.id, person.id),
            });
            continue;
          }
          for (const target of world.people) {
            // Сам себя участник не исключает — это уход, он проверяется отдельно.
            if (target.id === person.id) continue;
            attempts.push({
              label: `${person.name} исключает ${target.name} · ${house.name}`,
              expected: canExclude(person.viewer, house.id, target.viewer),
              run: () => end(house.id, target.id, person.id),
            });
          }
        }
      }
      break;
    }
    case 'journal-view':
    case 'notice-view': {
      const table = operation === 'journal-view' ? 'login_events' : 'password_resets';
      for (const viewer of world.people) {
        for (const owner of world.people) {
          attempts.push({
            label: `${viewer.name} · ${owner.name}`,
            expected: canViewAccountJournal(viewer.viewer, owner.id),
            run: () =>
              asApp(viewer, async (tx) => {
                // Без фильтра по владельцу в коде: чужие строки должна скрыть RLS.
                const { rows } = await tx.execute<{ account_id: string }>(
                  sql.raw(`SELECT account_id FROM ${table}`),
                );
                return rows.some((row) => row.account_id === owner.id);
              }),
          });
        }
      }
      break;
    }
  }

  const mismatches: string[] = [];
  let allowedByReference = 0;
  for (const attempt of attempts) {
    const actual = await attempt.run();
    if (attempt.expected) allowedByReference++;
    if (actual !== attempt.expected) {
      mismatches.push(
        `${IDENTITY_LABELS[operation]} · ${attempt.label}: эталон — ${answer(attempt.expected)}, база — ${answer(actual)}`,
      );
    }
  }
  return {
    operation,
    checks: attempts.length,
    allowedByReference,
    mismatches,
  };
}
