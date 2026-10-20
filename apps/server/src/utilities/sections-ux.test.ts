import { expect, it, vi } from 'vitest';
import { createWorld } from '../testing/world.ts';

it('D20a-11: плашка суммирует два неоплаченных месяца, переход — на ранний; долг после местного срока', async () => {
  const world = await createWorld();
  try {
    const device = world.device();
    await device.signIn(world.boris.username, world.boris.password);
    await world.database.admin.query(
      "UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1",
      [world.houseId],
    );
    const object = (
      await device.post('/api/objects', {
        title: 'Вымышленная квартира',
        objectType: 'property',
        placement: { spaceId: world.houseId, audience: 'adults' },
      })
    ).json<{ id: string }>();
    await device.post('/api/objects', {
      title: 'Вымышленный объект без счетов',
      objectType: 'property',
      placement: { spaceId: world.houseId, audience: 'adults' },
    });
    const acc = (await device.post(`/api/objects/${object.id}/accounts`, {})).json<{
      id: string;
    }>();
    const bill = async (period: string, cents: number, dueOn = '2026-10-22') => {
      const r = await device.post(`/api/accounts/${acc.id}/charges`, {
        period,
        totalCents: cents,
        dueOn,
      });
      expect(r.status, r.text).toBe(201);
      return r.json<{ id: string }>().id;
    };
    const pay = async (id: string, amountCents: number) => {
      const r = await device.post(`/api/charges/${id}/payments`, {
        amountCents,
        paidOn: '2026-10-01',
        method: 'cash',
        payer: { kind: 'member', accountId: world.boris.id },
      });
      expect(r.status, r.text).toBe(201);
    };
    const mainBill = await bill('2026-09', 10001);
    await pay(mainBill, 4001);
    await pay(await bill('2026-09', 100), 200);
    const nextBill = await bill('2026-10', 9000);
    const laterBill = await bill('2026-11', 7000, '2026-11-01');
    const cancelled = await bill('2026-08', 50000);
    expect(
      (await device.post(`/api/charges/${cancelled}/cancel`, { reason: 'Вымышленная ошибка' }))
        .status,
    ).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const [at, overdue] of [
      ['2026-10-21T19:00:00Z', false],
      ['2026-10-22T18:59:59Z', false],
      ['2026-10-22T19:00:00Z', true],
    ] as const) {
      vi.setSystemTime(new Date(at));
      const defaults = await device.get(
        `/api/utilities/month?scope=household&householdId=${world.houseId}`,
      );
      expect(defaults.status, defaults.text).toBe(200);
      const selected = defaults.json<{
        month: string;
        payableCents: number;
        objects: { id: string }[];
        totals: { remainingCents: number; overdue: boolean; dueOn: string };
      }>();
      expect(selected.month).toBe('2026-09');
      expect(selected.payableCents).toBe(15000);
      expect(selected.objects.map((o) => o.id)).toEqual([object.id]);
      expect(selected.totals).toMatchObject({ remainingCents: 6000, dueOn: '2026-10-22', overdue });
      const explicit = await device.get(
        `/api/utilities/month?month=${selected.month}&scope=household&householdId=${world.houseId}`,
      );
      expect(explicit.json()).toEqual(defaults.json());
    }
    const child = world.device();
    await child.signIn(world.vera.username, world.vera.password);
    expect((await child.get('/api/utilities/month')).json()).toMatchObject({
      objects: [],
      payableCents: 0,
    });
    expect((await device.get('/api/utilities/month?scope=personal')).json()).toMatchObject({
      payableCents: 0,
    });
    // 1 ноября ещё вне горизонта 24 октября и входит в него 25 октября, ровно за 7 дней.
    for (const [at, payableCents] of [
      ['2026-10-23T19:00:00Z', 15000],
      ['2026-10-24T19:00:00Z', 22000],
    ] as const) {
      vi.setSystemTime(new Date(at));
      expect((await device.get('/api/utilities/month')).json()).toMatchObject({ payableCents });
    }
    expect(
      (await device.post(`/api/charges/${laterBill}/cancel`, { reason: 'Вымышленная ошибка' }))
        .status,
    ).toBe(200);
    await pay(mainBill, 6000);
    await pay(nextBill, 9000);
    expect((await device.get('/api/utilities/month')).json()).toMatchObject({
      month: '2026-10',
      payableCents: 0,
      totals: { remainingCents: 0, dueOn: null, overdue: false },
    });
    vi.useRealTimers();
    const personal = await device.get('/api/utilities/month?scope=personal');
    expect(personal.json<{ totals: { remainingCents: number } }>().totals.remainingCents).toBe(0);
  } finally {
    vi.useRealTimers();
    await world.close();
  }
});

it('D20a-12: к передаче только актуальные показания; прошлый месяц и автоматические счета не предлагаются', async () => {
  const world = await createWorld();
  try {
    const device = world.device();
    await device.signIn(world.boris.username, world.boris.password);
    const object = (
      await device.post('/api/objects', { title: 'Вымышленный счётчик', objectType: 'property' })
    ).json<{ id: string }>();
    const add = async (method: 'automatic' | 'not_required' | 'phone', date: string) => {
      const account = (
        await device.post(`/api/objects/${object.id}/accounts`, {
          data: { transmission: method === 'phone' ? { method, phone: '000000' } : { method } },
        })
      ).json<{ id: string }>();
      const meter = await device.post(`/api/objects/${object.id}/meters`, {
        utilityAccountId: account.id,
        data: { resource: 'cold_water' },
        initialReading: { occurredOn: date, values: ['10'] },
      });
      expect(meter.status, meter.text).toBe(201);
      return account.id;
    };
    await add('phone', '2026-09-20');
    await add('automatic', '2026-10-20');
    await add('not_required', '2026-10-20');
    const manual = await add('phone', '2026-10-20');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const r = await device.get(`/api/objects/${object.id}/transmission`);
    expect(r.status, r.text).toBe(200);
    expect(r.json<{ utilityAccountId: string }[]>().map((a) => a.utilityAccountId)).toEqual([
      manual,
    ]);
  } finally {
    vi.useRealTimers();
    await world.close();
  }
});
