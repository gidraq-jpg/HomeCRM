// Пространства и состав дома: личное пространство вместе с учётной записью (SPACE-1), несколько
// домов у одной учётной записи (SPACE-2), уход из дома и исключение (SPACE-8, SPACE-9, PRD 7.3.12).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { spaces, tasks } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, rowsOf, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let database: TestDatabase;
let scene: Scene;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(database);
});

afterAll(async () => {
  await database?.drop();
});

describe('личное пространство вместе с учётной записью (SPACE-1)', () => {
  /** Транзакция службы входа: так учётные записи создаёт сервер. */
  async function authTransaction(statements: Array<[string, unknown[]]>): Promise<void> {
    const client = await database.auth.connect();
    try {
      await client.query('BEGIN');
      for (const [text, values] of statements) await client.query(text, values);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const account = (id: string, name: string): [string, unknown[]] => [
    'INSERT INTO accounts (id, display_name, email, username) VALUES ($1, $2, $3, $4)',
    [id, name, `${id}@family.invalid`, id],
  ];
  const personalSpace = (id: string, name: string): [string, unknown[]] => [
    `INSERT INTO spaces (kind, name, owner_account_id) VALUES ('personal', $2, $1)`,
    [id, `Личное: ${name}`],
  ];

  it('учётную запись без личного пространства база не принимает', async () => {
    const id = randomUUID();
    await expect(authTransaction([account(id, 'Без пространства')])).rejects.toMatchObject({
      code: '23000',
    });
    expect(await rowsOf(database.admin, 'SELECT 1 FROM accounts WHERE id = $1', [id])).toEqual([]);
  });

  it('вместе с пространством — принимает; у одной записи личное пространство одно', async () => {
    const id = randomUUID();
    await authTransaction([account(id, 'Нина'), personalSpace(id, 'Нина')]);
    const { rows } = await database.admin.query(
      `SELECT kind, owner_account_id FROM spaces WHERE owner_account_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ kind: 'personal', owner_account_id: id }]);
    await expect(authTransaction([personalSpace(id, 'Нина ещё раз')])).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('участников у личного пространства нет: только владелец', async () => {
    const anna = scene.person('anna');
    await expect(
      database.auth.query(
        `INSERT INTO space_members (space_id, space_kind, account_id, role) VALUES ($1, 'household', $2, 'adult')`,
        [anna.personalSpaceId, scene.person('boris').id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('несколько домов у одной учётной записи (SPACE-2)', () => {
  it('роль в каждом доме своя, а видно ровно то, где человек состоит', async () => {
    const anna = scene.person('anna');
    const boris = scene.person('boris');
    // Второй дом создаёт служба входа при первой настройке: Борис — его администратор, Анна — взрослая.
    const { rows } = await database.auth.query<{ id: string }>(
      `INSERT INTO spaces (kind, name) VALUES ('household', 'Дача') RETURNING id`,
    );
    const dacha = rows[0]?.id ?? '';
    await database.auth.query(
      `INSERT INTO space_members (space_id, account_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'adult')`,
      [dacha, boris.id, anna.id],
    );
    const visibleTo = async (who: 'anna' | 'boris' | 'vera') =>
      (await scene.as(who, (tx) => tx.select({ id: spaces.id, name: spaces.name }).from(spaces)))
        .map((row) => row.name)
        .sort();
    expect(await visibleTo('anna')).toEqual(['Дача', 'Дом', 'Личное: Анна']);
    expect(await visibleTo('boris')).toEqual(['Дача', 'Дом', 'Личное: Борис']);
    expect(await visibleTo('vera')).toEqual(['Дом', 'Личное: Вера']);

    // Анна — администратор Дома и взрослая на Даче: приглашать вправе только в Доме.
    const invite = (house: string) =>
      scene.as('anna', (tx) =>
        tx.execute(
          `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ('${house}', 'adult', '${randomUUID()}', '${anna.id}')` as never,
        ),
      );
    await expect(invite(dacha)).rejects.toSatisfy((error) => hasCode(error, ['42501']));
  });
});

describe('уход из дома и исключение (SPACE-8, SPACE-9, PRD 7.3.12)', () => {
  const leave = (house: string, who: string, by: string) =>
    database.auth.query(
      `UPDATE space_members SET left_at = now(), left_by = $3 WHERE space_id = $1 AND account_id = $2`,
      [house, who, by],
    );

  it('исключённый теряет дом, личное остаётся с ним, общие записи остаются в доме с прежним автором', async () => {
    const [home] = scene.family.houses;
    const houseId = home?.id ?? '';
    const anna = scene.person('anna');
    const vera = scene.person('vera');
    const boris = scene.person('boris');
    const familyPlace = scene.home('household');
    const adultsPlace = scene.home('adults');

    const sharedTask = await addTask({ author: anna.id, assignee: vera.id, place: familyPlace });
    const trashedTask = await addTask({
      author: anna.id,
      assignee: vera.id,
      place: familyPlace,
      trashed: true,
    });
    const myTask = await addTask({
      author: vera.id,
      assignee: vera.id,
      place: scene.personal('vera'),
    });
    const adultsNote = await addNote(database.admin, {
      author: anna,
      placement: adultsPlace,
      assigneeId: boris.id,
    });
    const veraNote = await addNote(database.admin, {
      author: vera,
      placement: familyPlace,
      title: 'написала Вера',
    });

    // Администратор исключает ребёнка: левая отметка и «кто» — служба входа записывает от её имени.
    await leave(houseId, vera.id, anna.id);

    // Вера: дом больше не видит, своё личное — да, и строка собственного членства осталась видна ей.
    const veraSees = await scene.as('vera', async (tx) => ({
      tasks: (await tx.select({ id: tasks.id }).from(tasks)).map((row) => row.id),
      spaces: (await tx.select({ name: spaces.name }).from(spaces)).map((row) => row.name),
    }));
    expect(veraSees.tasks).toEqual([myTask]);
    expect(veraSees.spaces).toEqual(['Личное: Вера']);

    // Дом сохранил её записи, а автор — по-прежнему Вера: интерфейс покажет «бывший участник».
    const annaSees = await rowsOf<{ id: string; author_id: string }>(
      database.admin,
      `SELECT id, author_id FROM notes WHERE id = $1`,
      [veraNote],
    );
    expect(annaSees).toEqual([{ id: veraNote, author_id: vera.id }]);
    expect(
      (
        await scene.as('anna', (tx) =>
          tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, sharedTask)),
        )
      ).length,
    ).toBe(1);

    // Ответственность переходит администратору: обработчик передаёт записи, пока ответственный — ушедший.
    const moved = await database.worker.query<{ moved: number }>(
      'SELECT app.reassign_responsibility() AS moved',
    );
    expect(moved.rows[0]?.moved).toBeGreaterThanOrEqual(2); // дело и записи Веры в общем
    const assignees = await rowsOf<{ id: string; assignee_id: string }>(
      database.admin,
      `SELECT id, assignee_id FROM tasks WHERE id = ANY($1)`,
      [[sharedTask, trashedTask, myTask]],
    );
    const byId = new Map(assignees.map((row) => [row.id, row.assignee_id]));
    expect(byId.get(sharedTask)).toBe(anna.id);
    expect(byId.get(trashedTask)).toBe(vera.id); // запись в корзине не трогаем: её восстановят и передадут позже
    expect(byId.get(myTask)).toBe(vera.id); // личное остаётся у человека
    // Во «Взрослых» ответственный Борис — он не уходил, запись не тронута.
    expect(
      (
        await rowsOf<{ assignee_id: string }>(
          database.admin,
          'SELECT assignee_id FROM notes WHERE id = $1',
          [adultsNote],
        )
      )[0]?.assignee_id,
    ).toBe(boris.id);

    // Передача записана в историю от имени системы; второй вызов ничего не находит.
    const events = await rowsOf<{ actor_id: string | null; changes: Record<string, unknown> }>(
      database.admin,
      `SELECT actor_id, changes FROM tasks_history WHERE record_id = $1 AND operation = 'update'`,
      [sharedTask],
    );
    expect(events).toEqual([
      { actor_id: null, changes: { assignee_id: { old: vera.id, new: anna.id } } },
    ]);
    expect(
      (
        await database.worker.query<{ moved: number }>(
          'SELECT app.reassign_responsibility() AS moved',
        )
      ).rows[0]?.moved,
    ).toBe(0);
  });

  it('взрослый уходит сам: записи «Взрослые», где он ответственный, переходят администратору', async () => {
    const [home] = scene.family.houses;
    const houseId = home?.id ?? '';
    const anna = scene.person('anna');
    const boris = scene.person('boris');
    const noteId = await addNote(database.admin, {
      author: anna,
      placement: scene.home('adults'),
      assigneeId: boris.id,
    });
    await leave(houseId, boris.id, boris.id);
    // Дом он потерял, а Дачу и личное сохранил.
    const names = (await scene.as('boris', (tx) => tx.select({ name: spaces.name }).from(spaces)))
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(['Дача', 'Личное: Борис']);
    await database.worker.query('SELECT app.reassign_responsibility()');
    const [row] = await rowsOf<{ assignee_id: string }>(
      database.admin,
      'SELECT assignee_id FROM notes WHERE id = $1',
      [noteId],
    );
    expect(row?.assignee_id).toBe(anna.id);
  });

  it('участник двух домов уходит из одного и остаётся в другом со своей ролью', async () => {
    const [, neighbours] = scene.family.houses;
    const mila = scene.person('mila');
    await leave(neighbours?.id ?? '', mila.id, mila.id);
    const names = (await scene.as('mila', (tx) => tx.select({ name: spaces.name }).from(spaces)))
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(['Дом', 'Личное: Мила']);
  });

  it('последний администратор дом не покидает и роль не сдаёт', async () => {
    const [, neighbours] = scene.family.houses;
    const dina = scene.person('dina');
    await expect(leave(neighbours?.id ?? '', dina.id, dina.id)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      database.auth.query(`UPDATE space_members SET role = 'adult' WHERE account_id = $1`, [
        dina.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' }); // службе входа менять роли не выдано; триггер — второй рубеж
  });

  it('вернуть ушедшего правкой строки нельзя, а исключать вправе только администратор дома', async () => {
    const [home] = scene.family.houses;
    const houseId = home?.id ?? '';
    const vera = scene.person('vera');
    const returned = await database.auth.query(
      `UPDATE space_members SET left_at = NULL, left_by = NULL WHERE space_id = $1 AND account_id = $2`,
      [houseId, vera.id],
    );
    expect(returned.rowCount).toBe(0);
    // Мила уже ребёнок в Доме, Борис ушёл; взрослому Борису исключать нельзя, даже пока он был в доме.
    await expect(
      leave(houseId, scene.person('mila').id, scene.person('vera').id),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  async function addTask(input: {
    author: string;
    assignee: string;
    place: ReturnType<Scene['home']>;
    trashed?: boolean;
  }): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `INSERT INTO tasks (space_id, space_kind, audience, author_id, assignee_id, title, deleted_at)
       VALUES ($1, $2, $3, $4, $5, 'дело', CASE WHEN $6 THEN now() - interval '1 day' END) RETURNING id`,
      [
        input.place.spaceId,
        input.place.kind,
        input.place.kind === 'household' ? input.place.audience : null,
        input.author,
        input.assignee,
        input.trashed === true,
      ],
    );
    return rows[0]?.id ?? '';
  }
});
