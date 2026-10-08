import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
});
afterAll(async () => world?.close());
async function object(audience = 'adults') {
  const r = await adult.post('/api/objects', {
    title: 'Вымышленная сводка',
    objectType: 'property',
    placement: { spaceId: world.houseId, audience },
  });
  expect(r.status, r.text).toBe(201);
  return r.json<{ id: string }>().id;
}
async function account(parent: string) {
  const r = await adult.post(`/api/objects/${parent}/accounts`, {
    data: { transmission: { method: 'not_required' } },
  });
  expect(r.status, r.text).toBe(201);
  return r.json<{ id: string }>().id;
}
async function charge(
  accountId: string,
  period: string,
  totalCents: number,
  extra: Record<string, unknown> = {},
) {
  const r = await adult.post(`/api/accounts/${accountId}/charges`, {
    period,
    totalCents,
    dueOn: '2026-11-15',
    ...extra,
  });
  expect(r.status, r.text).toBe(201);
  return r.json<{ id: string }>().id;
}
async function pay(id: string, amountCents: number, paidOn = '2026-10-08') {
  const r = await adult.post(`/api/charges/${id}/payments`, {
    amountCents,
    paidOn,
    method: 'tenant',
    payer: { kind: 'tenant' },
  });
  expect(r.status, r.text).toBe(201);
  return r.json<{ id: string }>().id;
}
it('UTIL-11: частичная оплата, перерасчёт, отмены и отдельный остаток по каждому начислению; суммы взрослых скрыты', async () => {
  const id = await object();
  const acc = await account(id);
  const bill = await charge(acc, '2026-10', 10000, {
    lines: [
      { title: 'Услуга', amountCents: 12000 },
      { title: 'Перерасчёт', amountCents: -2000, kind: 'adjustment' },
    ],
  });
  await pay(bill, 3000);
  const wrong = await pay(bill, 2000);
  expect(
    (await adult.post(`/api/payments/${wrong}/cancel`, { reason: 'Вымышленная ошибка' })).status,
  ).toBe(200);
  const cancelled = await charge(acc, '2026-10', 50000);
  expect(
    (await adult.post(`/api/charges/${cancelled}/cancel`, { reason: 'Вымышленная ошибка' })).status,
  ).toBe(200);
  await charge(acc, '2026-09', 99999);
  const result = await adult.get('/api/utilities/month?month=2026-10');
  expect(result.status, result.text).toBe(200);
  expect(result.json()).toMatchObject({
    totals: { chargedCents: 10000, paidCents: 3000, remainingCents: 7000 },
    objects: [
      {
        id,
        chargedCents: 10000,
        paidCents: 3000,
        remainingCents: 7000,
        accounts: [{ status: 'not_required' }],
      },
    ],
  });
  const hidden = await child.get('/api/utilities/month?month=2026-10');
  expect(hidden.status, hidden.text).toBe(200);
  expect(hidden.text).not.toContain(id);
  expect(hidden.json()).toMatchObject({
    totals: { chargedCents: 0, paidCents: 0, remainingCents: 0 },
  });
  expect((await adult.get('/api/utilities/month?month=2026-13')).status).toBe(400);
});
it('UTIL-12: расход через ноль и замену, точные строки, месяцы оплат и сравнение с прошлым годом', async () => {
  const id = await object();
  const acc = await account(id);
  const bill = await charge(acc, '2026-10', 12345);
  await pay(bill, 12000, '2026-11-01');
  await charge(acc, '2025-10', 5678);
  const m = await adult.post(`/api/objects/${id}/meters`, {
    data: { resource: 'cold_water', integerDigits: 3, fractionDigits: 3 },
  });
  expect(m.status, m.text).toBe(201);
  const meter = m.json<{ id: string }>().id;
  for (const [date, values, rollover] of [
    ['2026-09-01', ['999.900'], false],
    ['2026-10-01', ['0.100'], true],
  ] as const) {
    const r = await adult.post(`/api/meters/${meter}/readings`, {
      occurredOn: date,
      values,
      rollover,
    });
    expect(r.status, r.text).toBe(201);
  }
  const replaced = await adult.post(`/api/meters/${meter}/replace`, {
    finalReading: { occurredOn: '2026-10-02', values: ['0.200'] },
    newMeter: {
      data: { resource: 'cold_water' },
      initialReading: { occurredOn: '2026-10-02', values: ['20.000'] },
    },
  });
  expect(replaced.status, replaced.text).toBe(201);
  const next = replaced.json<{ newMeter: { id: string } }>().newMeter.id;
  const r = await adult.post(`/api/meters/${next}/readings`, {
    occurredOn: '2026-10-20',
    values: ['20.333'],
  });
  expect(r.status, r.text).toBe(201);
  const result = await adult.get(`/api/objects/${id}/analytics?month=2026-11`);
  expect(result.status, result.text).toBe(200);
  const rows = result.json<{
    months: {
      month: string;
      chargedCents: number;
      paidCents: number;
      consumption: { value: string }[];
      previousYear: { chargedCents: number };
    }[];
  }>().months;
  expect(rows).toHaveLength(12);
  expect(rows.find((r) => r.month === '2026-10')).toMatchObject({
    chargedCents: 12345,
    paidCents: 0,
    consumption: [{ value: '0.633' }],
    previousYear: { chargedCents: 5678 },
  });
  expect(rows.find((r) => r.month === '2026-11')).toMatchObject({ paidCents: 12000 });
  expect((await child.get(`/api/objects/${id}/analytics`)).status).toBe(404);
});
it('UTIL-11: статус окна требует каждый прибор, учитывает границы и ручную отметку без приборов', async () => {
  const id = await object();
  const rule = {
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day: 20, endDay: 25 },
  };
  const response = await adult.post(`/api/objects/${id}/accounts`, {
    data: { readingRule: rule, transmission: { method: 'gosuslugi_dom' } },
  });
  expect(response.status, response.text).toBe(201);
  const acc = response.json<{ id: string }>().id;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const meter = await adult.post(`/api/objects/${id}/meters`, {
      utilityAccountId: acc,
      data: { resource: 'cold_water' },
    });
    expect(meter.status, meter.text).toBe(201);
    ids.push(meter.json<{ id: string }>().id);
  }
  async function status(month = '2026-09') {
    const response = await adult.get(`/api/utilities/month?month=${month}`);
    expect(response.status, response.text).toBe(200);
    return response
      .json<{ objects: { id: string; accounts: { id: string; status: string }[] }[] }>()
      .objects.find((o) => o.id === id)
      ?.accounts.find((a) => a.id === acc)?.status;
  }
  expect(await status()).toBe('not_transmitted');
  // Два показания одного прибора не заменяют показания второго.
  for (const [meter, date, value] of [
    [ids[0], '2026-09-20', '1'],
    [ids[0], '2026-09-21', '2'],
    [ids[1], '2026-09-19', '1'],
  ] as const) {
    const response = await adult.post(`/api/meters/${meter}/readings`, {
      occurredOn: date,
      values: [value],
    });
    expect(response.status, response.text).toBe(201);
    expect(
      (
        await adult.post(`/api/objects/${id}/readings/transmit`, {
          readingIds: [response.json<{ id: string }>().id],
          method: 'Вымышленный способ',
        })
      ).status,
    ).toBe(200);
  }
  expect(await status()).toBe('not_transmitted');
  const final = await adult.post(`/api/meters/${ids[1]}/readings`, {
    occurredOn: '2026-09-25',
    values: ['2'],
  });
  expect(final.status, final.text).toBe(201);
  expect(
    (
      await adult.post(`/api/objects/${id}/readings/transmit`, {
        readingIds: [final.json<{ id: string }>().id],
        method: 'Вымышленный способ',
      })
    ).status,
  ).toBe(200);
  expect(await status()).toBe('transmitted');
  expect(await status('2090-10')).toBe('not_open');
  const manual = await adult.post(`/api/objects/${id}/accounts`, {
    data: { readingRule: rule, transmission: { method: 'phone', phone: '000000' } },
  });
  expect(manual.status, manual.text).toBe(201);
  const manualId = manual.json<{ id: string }>().id;
  await world.database.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id,completed_at)
    SELECT id,'2026-09-20','2026-09-19T19:00Z','2026-09-25T18:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,audience,author_id,assignee_id,now() FROM deadlines WHERE utility_account_id=$1 AND source_kind='readings'`,
    [manualId],
  );
  const summary = (await adult.get('/api/utilities/month?month=2026-09')).json<{
    objects: { id: string; accounts: { id: string; status: string }[] }[];
  }>();
  expect(
    summary.objects.find((o) => o.id === id)?.accounts.find((a) => a.id === manualId)?.status,
  ).toBe('transmitted');
});

it('UTIL-11: окно первого числа начинается в местную полночь Asia/Vladivostok', async () => {
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Vladivostok' WHERE id=$1", [
    world.houseId,
  ]);
  const id = await object();
  const response = await adult.post(`/api/objects/${id}/accounts`, {
    data: {
      transmission: { method: 'phone', phone: '000000' },
      readingRule: {
        kind: 'repeat',
        anchor: '2026-10-01',
        repeat: { unit: 'month', day: 1 },
        endTime: '00:00',
      },
    },
  });
  expect(response.status, response.text).toBe(201);
  const acc = response.json<{ id: string }>().id;
  const status = async () => {
    const result = await adult.get('/api/utilities/month?month=2026-10');
    expect(result.status, result.text).toBe(200);
    return result
      .json<{ objects: { id: string; accounts: { id: string; status: string }[] }[] }>()
      .objects.find((o) => o.id === id)
      ?.accounts.find((a) => a.id === acc)?.status;
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-09-30T13:59:59Z'));
    expect(await status()).toBe('not_open');
    vi.setSystemTime(new Date('2026-09-30T14:00:00Z'));
    expect(await status()).toBe('not_transmitted');
    vi.setSystemTime(new Date('2026-09-30T14:00:01Z'));
    expect(await status()).toBe('not_transmitted');
  } finally {
    vi.useRealTimers();
  }
});
