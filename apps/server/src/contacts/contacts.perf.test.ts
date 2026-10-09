import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  admin = (await signedInAdmin(world)).device;
  await world.database.admin.query(
    `INSERT INTO contacts(space_id,space_kind,author_id,title,kind,data)
  SELECT $1,'personal',$2,'Вымышленный контакт замера '||i,'person','{"categories":["friend"],"phones":[],"emails":[],"messengers":[],"address":"","birthday":null,"note":""}' FROM generate_series(1,1000) i`,
    [world.boris.personalSpaceId, world.boris.id],
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await world?.close();
});
it('CONT-1: 1000 контактов, страница 100, p95 до 300 мс; число SQL не зависит от размера страницы', async () => {
  const tracked = new WeakSet<object>();
  const probes: { mock: { calls: unknown[][] }; mockClear(): unknown }[] = [];
  const acquire = (client: { query: typeof world.database.app.query }) => {
    if (!tracked.has(client)) {
      tracked.add(client);
      probes.push(vi.spyOn(client, 'query'));
    }
  };
  world.database.app.on('acquire', acquire);
  try {
    for (let i = 0; i < 3; i++) await adult.get('/api/contacts?kind=person&limit=100');
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const response = await adult.get('/api/contacts?kind=person&limit=100');
      times.push(performance.now() - start);
      expect(response.status, response.text).toBe(200);
      expect(response.json<unknown[]>()).toHaveLength(100);
    }
    const p95 = percentile(times, 0.95);
    console.info(`Contacts 1000, page 100: p95=${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(300);
    const count = async (limit: number) => {
      for (const probe of probes) probe.mockClear();
      await adult.get(`/api/contacts?kind=person&limit=${limit}`);
      return probes.reduce((n, p) => n + p.mock.calls.length, 0);
    };
    const small = await count(1),
      large = await count(100);
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
    expect((await admin.get('/api/contacts?kind=person&limit=100')).json()).toEqual([]);
  } finally {
    world.database.app.off('acquire', acquire);
  }
});
