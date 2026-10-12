import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeHouseTimeZones } from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';
import { scheduleSummaries, summaryHasContent, summaryPeriod } from './summaries.ts';

let world: World, adult: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => world?.close());
beforeEach(async () => {
  for (const table of ['deadline_notifications', 'summaries', 'documents'])
    await world.database.admin.query(`DELETE FROM ${table}`);
  await world.clearRateLimits();
});

it.each(['assignee', 'restore', 'move'] as const)(
  'NOTIF-5: %s через API не переносит подтверждение продления из недели A в B',
  async (action) => {
    const now = new Date();
    const previous = summaryPeriod(now, 'Asia/Yekaterinburg', 'weekly');
    const a = summaryPeriod(new Date(+previous.end + 7 * 86400000), 'Asia/Yekaterinburg', 'weekly');
    const b = summaryPeriod(new Date(+a.end + 7 * 86400000), 'Asia/Yekaterinburg', 'weekly');
    const created = await adult.post('/api/documents', {
      title: 'Вымышленный договор подтверждения',
      data: { type: 'contract', expiresOn: '2026-01-01' },
    });
    expect(created.status, created.text).toBe(201);
    const id = created.json<{ id: string }>().id;
    const renewed = await adult.post(`/api/documents/${id}/renew`, {
      data: { type: 'contract', indefinite: true },
    });
    expect(renewed.status, renewed.text).toBe(201);
    const summaries = [];
    for (const period of [a, b]) {
      const result = await world.database.admin.query(
        `INSERT INTO summaries(account_id,household_id,time_zone,kind,local_date,period_start,period_end)
         VALUES($1,$2,'Asia/Yekaterinburg','weekly',$3,$4,$5) RETURNING id`,
        [world.boris.id, world.houseId, period.date, period.start, period.end],
      );
      summaries.push(result.rows[0].id as string);
    }
    const [summaryA, summaryB] = summaries;
    if (!summaryA || !summaryB) throw new Error('Missing test summaries');
    const content = async (summaryId: string) => {
      const response = await adult.get(`/api/summaries/${summaryId}`);
      expect(response.status, response.text).toBe(200);
      return response.json<{ done: { id: string; at: string }[] }>().done;
    };
    const presence = async () => {
      const client = await world.database.worker.connect();
      try {
        return {
          A: await summaryHasContent(client, summaryA, b.end),
          B: await summaryHasContent(client, summaryB, b.end),
        };
      } finally {
        client.release();
      }
    };
    const confirmation = await content(summaryA);
    expect(confirmation).toEqual([expect.objectContaining({ id })]);
    expect(await content(summaryB)).toEqual([]);
    expect(await presence()).toEqual({ A: true, B: false });

    // Только часы общего updated_at переводим в B. Мутации выполняет настоящий API;
    // момент смены статуса и новый источник подтверждения тест не подменяет.
    await world.database.admin.query(`
      CREATE FUNCTION public.document_summary_clock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at := '${new Date(+b.start + 3600000).toISOString()}'::timestamptz; RETURN NEW; END $$;
      CREATE TRIGGER documents_zz_summary_clock BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION public.document_summary_clock()`);
    try {
      if (action === 'assignee') {
        const response = await adult.post(`/api/documents/${id}/assignee`, {
          assigneeId: world.boris.id,
        });
        expect(response.status, response.text).toBe(200);
      } else if (action === 'restore') {
        expect((await adult.post(`/api/documents/${id}/trash`, {})).status).toBe(200);
        expect(await content(summaryA)).toEqual([]);
        expect(await presence()).toEqual({ A: false, B: false });
        const response = await adult.post(`/api/documents/${id}/restore`, {});
        expect(response.status, response.text).toBe(200);
      } else {
        const response = await adult.post(`/api/documents/${id}/move`, {
          spaceId: world.houseId,
          audience: 'household',
          confirmed: true,
        });
        expect(response.status, response.text).toBe(200);
      }
      expect.soft(await content(summaryA)).toEqual(confirmation);
      expect.soft(await content(summaryB)).toEqual([]);
      expect.soft(await presence()).toEqual({ A: true, B: false });
      // Новый запуск планировщика в B без иных источников не должен создавать push.
      await world.database.admin.query('DELETE FROM summaries WHERE id=$1', [summaries[1]]);
      await scheduleSummaries(world.database.worker, b.end);
      expect
        .soft(
          (
            await world.database.admin.query(
              `SELECT n.id FROM deadline_notifications n JOIN summaries s ON s.id=n.record_id
           WHERE n.record_table='summaries' AND s.account_id=$1 AND s.kind='weekly' AND s.local_date=$2`,
              [world.boris.id, b.date],
            )
          ).rows,
        )
        .toEqual([]);
    } finally {
      await world.database.admin.query(
        'DROP TRIGGER documents_zz_summary_clock ON documents; DROP FUNCTION public.document_summary_clock()',
      );
    }
  },
);
