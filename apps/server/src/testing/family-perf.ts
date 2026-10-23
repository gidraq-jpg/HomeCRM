import { sql } from '@homecrm/db';
import { localDate } from '@homecrm/shared';
import type { World } from './world.ts';

/** Только одноразовый тестовый мир: 10 000 первичных записей и производные сроки.
 * Seed определяет распределение, содержимое и даты; UUID создаёт тестовая база.
 */
export async function seedPerfFamily(world: World, seed = 23) {
  if (!world.database.name.startsWith('homecrm_test_')) throw new Error('Test database required');
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
  const today = localDate(new Date(), 'Asia/Yekaterinburg');
  const args = [
    world.houseId,
    world.boris.personalSpaceId,
    world.boris.id,
    world.vera.personalSpaceId,
    world.vera.id,
    seed,
  ];
  // 50% общее, 30% личное взрослого, 20% личное ребёнка; 5% в корзине.
  const source = (count: number) =>
    `SELECT i, mod(i*37+$6::int,100) AS bucket FROM generate_series(1,${count}) i`;
  const placement = `CASE WHEN bucket<50 THEN $1::uuid WHEN bucket<80 THEN $2::uuid ELSE $4::uuid END,
    CASE WHEN bucket<50 THEN 'household'::space_kind ELSE 'personal'::space_kind END,
    CASE WHEN bucket<40 THEN 'household'::audience WHEN bucket<50 THEN 'adults'::audience END,
    CASE WHEN bucket<80 THEN $3::uuid ELSE $5::uuid END`;
  const columns = 'space_id,space_kind,audience,author_id,title,deleted_at';
  const values = `${placement},'Вымышленный семейный ремонт '||i,CASE WHEN bucket>=95 THEN now() END`;
  for (const [table, count] of [
    ['notes', 3000],
    ['contacts', 1000],
    ['documents', 1000],
    ['objects', 1000],
    ['shopping_items', 1000],
  ] as const)
    await world.database.admin.query(
      `INSERT INTO ${table}(${columns}) SELECT ${values} FROM (${source(count)}) s`,
      args,
    );
  await world.database.admin.query(
    `INSERT INTO tasks(${columns},assignee_id,household_id,plan_on,series_id,repeat_rule,repeat_template)
    SELECT ${values},CASE WHEN bucket<80 THEN $3::uuid ELSE $5::uuid END,$1::uuid,
    $7::date+(i%180-30),CASE WHEN i%3=0 THEN gen_random_uuid() END,
    CASE WHEN i%3=0 THEN '{"kind":"daily"}'::jsonb END,CASE WHEN i%3=0 THEN '{}'::jsonb END
    FROM (${source(1000)}) s`,
    [...args, today],
  );
  // Лицевой счёт — служебный родитель начислений, сверх 10 000 первичных записей.
  const account =
    await world.database.admin.query(`INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id)
    SELECT space_id,space_kind,audience,author_id,'Вымышленный счёт',id FROM objects WHERE space_kind='household' AND deleted_at IS NULL LIMIT 1 RETURNING id`);
  await world.database.admin.query(
    `INSERT INTO utility_charges(space_id,space_kind,audience,author_id,title,parent_id,period,total_cents,due_on)
    SELECT $1,'household','household',$2,'Вымышленное начисление '||i,$3,'2026-10',10000+i,$4::date+(i%365)
    FROM generate_series(1,1000) i`,
    [world.houseId, world.boris.id, account.rows[0]?.id, today],
  );
  await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.execute(sql`INSERT INTO deadlines(note_id,household_id,rule,space_id,space_kind,audience,author_id,assignee_id)
    SELECT id,${world.houseId}::uuid,jsonb_build_object('kind','date','date',(${today}::date + (substring(title from '[0-9]+$')::int % 365))::text,'time','09:00','warnings','[]'::jsonb),
    space_id,space_kind,audience,author_id,author_id FROM notes WHERE deleted_at IS NULL AND author_id=${world.boris.id}::uuid ORDER BY title,id LIMIT 1000`),
  );
  await world.database.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id)
    SELECT id,(rule->>'date')::date,((rule->>'date')::date::timestamp AT TIME ZONE 'Asia/Yekaterinburg'),((rule->>'date')::date::timestamp AT TIME ZONE 'Asia/Yekaterinburg'),
    'Asia/Yekaterinburg','[]',space_id,space_kind,audience,author_id,assignee_id FROM deadlines WHERE deleted_at IS NULL
    ON CONFLICT(deadline_id,date) DO NOTHING`,
  );
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
  await world.database.admin.query('ANALYZE');
  return { today, seed, records: 10000 };
}
