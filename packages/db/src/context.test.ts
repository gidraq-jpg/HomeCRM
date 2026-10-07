// Контекст запроса (ADR-0004): без него роль приложения не видит ни одной строки,
// и он не переживает свою транзакцию — даже на том же соединении пула.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAppDatabase, type Transaction } from './client.ts';
import { RECORD_DEFINITIONS, RECORD_TABLES } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';

const family = buildFamily();
const anna = family.person('anna');
let database: TestDatabase;
let tables: string[];

// Таблицы входа, которых у приложения нет вовсе: пароли, секреты, сессии, счётчики (ADR-0005).
const AUTH_ONLY = [
  'credentials',
  'login_locks',
  'login_name_attempts',
  'rate_limits',
  'sessions',
  'two_factors',
  'verifications',
];
// Данные и сведения, которые приложение читает под контекстом участника.
// Таблицы записей и их истории берутся из recordTable(): новая таблица попадает сюда сама.
const RECORD_NAMES = RECORD_DEFINITIONS.map((definition) => definition.name);
const APP_TABLES = [
  'deadlines',
  'deadline_occurrences',
  'deadline_notifications',
  'search_index',
  'profile_files',
  'file_blobs',
  'record_links',
  'accounts',
  'household_access',
  'member_profiles',
  'invitations',
  'login_events',
  'password_resets',
  'space_members',
  'spaces',
  ...RECORD_NAMES,
  ...RECORD_NAMES.map((name) => `${name}_history`),
];
// Эти таблицы наполняет seedFamily: проверка «без контекста пусто» не вырождена.
const SEEDED = new Set([
  'search_index',
  'profile_files',
  'file_blobs',
  'accounts',
  'household_access',
  'member_profiles',
  'space_members',
  'spaces',
  ...RECORD_NAMES,
  ...RECORD_NAMES.map((name) => `${name}_history`),
]);

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  const file = await database.admin.query(
    `INSERT INTO profile_files(account_id,title,mime_type,size_bytes,storage_key,envelope) VALUES ($1,'Фото','image/jpeg',32,gen_random_uuid(),'{}') RETURNING id`,
    [anna.id],
  );
  await database.admin.query('UPDATE member_profiles SET photo_file_id=$1 WHERE account_id=$2', [
    file.rows[0].id,
    anna.id,
  ]);
  const { rows } = await database.admin.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  tables = rows.map((row) => row.name).sort();
});

afterAll(async () => {
  await database?.drop();
});

async function count(pool: pg.Pool | pg.PoolClient, table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]?.n ?? Number.NaN;
}

async function countIn(tx: Transaction, table: string): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(
    sql.raw(`SELECT count(*)::int AS n FROM "${table}"`),
  );
  return rows[0]?.n ?? Number.NaN;
}

describe('контекст запроса', () => {
  it('без контекста роль приложения не видит ни одной строки ни в одной таблице', async () => {
    expect(tables).toEqual([...APP_TABLES, ...AUTH_ONLY].sort());
    for (const table of APP_TABLES) {
      if (SEEDED.has(table)) expect(await count(database.admin, table), table).toBeGreaterThan(0);
      expect(await count(database.app, table), table).toBe(0);
    }
    // Таблицы входа приложению не выданы: не «пусто», а отказ.
    for (const table of AUTH_ONLY) {
      await expect(count(database.app, table), table).rejects.toMatchObject({ code: '42501' });
    }
    // И внутри транзакции, где set_config не вызывали.
    const client = await database.app.connect();
    try {
      await client.query('BEGIN');
      for (const table of APP_TABLES) expect(await count(client, table), table).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('учётная запись без личного пространства и членств не видит ничего', async () => {
    const app = createAppDatabase(database.app);
    const stranger = randomUUID();
    for (const table of APP_TABLES) {
      expect(await app.withAccount(stranger, (tx) => countIn(tx, table)), table).toBe(0);
    }
  });

  it('контекст действует только до конца своей транзакции', async () => {
    // Одно соединение: следующий запрос гарантированно идёт по тому же.
    const single = database.pool('app', 1);
    const app = createAppDatabase(single);
    expect(await app.withAccount(anna.id, (tx) => countIn(tx, 'notes'))).toBeGreaterThan(0);

    const { rows } = await single.query(
      `SELECT current_setting('app.account_id', true) AS setting, app.current_account_id() AS account,
        (SELECT count(*)::int FROM notes) AS notes`,
    );
    // Параметр остался на соединении пустой строкой — поэтому в app.current_account_id() есть nullif.
    expect(rows[0]).toEqual({ setting: '', account: null, notes: 0 });
  });

  it('после ошибки внутри транзакции контекст тоже сброшен', async () => {
    const single = database.pool('app', 1);
    const app = createAppDatabase(single);
    await expect(
      app.withAccount(anna.id, async (tx) => {
        expect(await countIn(tx, 'notes')).toBeGreaterThan(0);
        throw new Error('сбой в коде приложения');
      }),
    ).rejects.toThrow('сбой в коде приложения');
    expect(await count(single, 'notes')).toBe(0);
  });

  it('withAccount принимает только UUID', async () => {
    const app = createAppDatabase(database.app);
    for (const bad of ['', 'anna', `${anna.id}' OR true --`]) {
      await expect(app.withAccount(bad, async () => 1)).rejects.toThrow(TypeError);
    }
  });

  it('запрос без фильтра в коде не возвращает чужое личное', async () => {
    const app = createAppDatabase(database.app);
    for (const viewer of family.people) {
      // Никакого where: защищает только RLS.
      const rows = await app.withAccount(viewer.id, async (tx) => {
        const all = [];
        for (const table of Object.values(RECORD_TABLES))
          all.push(...(await tx.select().from(table)));
        return all;
      });
      const personal = rows.filter((row) => row.spaceKind === 'personal');
      expect(
        personal.every((row) => row.spaceId === viewer.personalSpaceId),
        viewer.name,
      ).toBe(true);
      const ownPersonal = family.records.filter(
        (record) =>
          record.facts.placement.kind === 'personal' &&
          record.facts.placement.ownerId === viewer.id,
      );
      expect(personal, viewer.name).toHaveLength(ownPersonal.length);
      for (const row of rows.filter((candidate) => candidate.spaceKind === 'household')) {
        const role = viewer.viewer.memberships.get(row.spaceId);
        expect(role, viewer.name).toBeDefined();
        if (role === 'child') expect(row.audience, viewer.name).toBe('household');
      }
    }
  });
});
