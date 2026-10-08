import { randomUUID } from 'node:crypto';
import type { UtilityAccountData } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHousehold, provisionAccount } from '../auth/provision.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let child: Device;
let admin: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
interface RecordRow {
  id: string;
  spaceId: string;
  audience: string;
  deletedAt: string | null;
  updatedAt: string;
}
interface Contact extends RecordRow {
  data: { organizationType: string; phones: unknown[] };
}
interface Account extends RecordRow {
  supplierHidden: boolean;
  parentId: string;
  supplierId: string | null;
  supplier: { id: string; title: string } | null;
  data: ReturnType<typeof UtilityAccountData.parse>;
}
interface Property extends RecordRow {
  typeData: Record<string, unknown>;
  peopleAndOrganizations: { role: string; contact: Contact }[];
}
async function property(device = adult, body: Record<string, unknown> = {}) {
  const result = await device.post('/api/objects', {
    title: 'Вымышленная квартира',
    objectType: 'property',
    placement: { spaceId: world.houseId, audience: 'adults' },
    ...body,
  });
  expect(result.status, result.text).toBe(201);
  return result.json<Property>();
}
async function contact(device = adult, body: Record<string, unknown> = {}) {
  const result = await device.post('/api/contacts', { title: 'Вымышленная УК', ...body });
  expect(result.status, result.text).toBe(201);
  return result.json<Contact>();
}
async function account(parent: string, device = adult, body: Record<string, unknown> = {}) {
  const result = await device.post(`/api/objects/${parent}/accounts`, body);
  expect(result.status, result.text).toBe(201);
  return result.json<Account>();
}
it('S1: первая квартира только с названием, три лицевых счёта, поставщик и аварийные телефоны', async () => {
  const object = await property(adult, {
    typeData: {
      address: 'Вымышленный проспект, 1',
      cadastralNumber: '66:41:0101001:123',
      areaHundredths: 5731,
      status: 'living',
      ownerMemberIds: [world.boris.id],
    },
  });
  expect(object.spaceId).toBe(world.houseId);
  expect(object.audience).toBe('adults');
  const provider = await contact(adult, {
    data: {
      organizationType: 'management',
      phones: [{ number: '+7 000 123-45-67', label: 'Аварийная', emergency: true }],
    },
  });
  expect(provider.audience).toBe('household');
  const link = await adult.post('/api/links', {
    left: { type: 'object', id: object.id },
    right: { type: 'contact', id: provider.id },
    role: 'УК',
  });
  expect(link.status, link.text).toBe(201);
  const ids = [];
  for (const service of ['maintenance', 'electricity', 'water_sewerage']) {
    const created = await account(object.id, adult, {
      supplierId: provider.id,
      data: {
        services: [service],
        number: `TEST-${service}`,
        readingRule: {
          kind: 'repeat',
          anchor: '2026-01-01',
          repeat: { unit: 'month', day: 20, endDay: 25 },
        },
        paymentRule: { kind: 'repeat', anchor: '2026-02-01', repeat: { unit: 'month', day: 15 } },
      },
    });
    expect(created.audience).toBe('adults');
    expect(created.supplierId).toBe(provider.id);
    ids.push(created.id);
  }
  const listed = (await adult.get(`/api/objects/${object.id}/accounts`)).json<Account[]>();
  expect(listed.map((row) => row.id).sort()).toEqual(ids.sort());
  const card = (await adult.get(`/api/objects/${object.id}`)).json<Property>();
  expect(card.peopleAndOrganizations[0]?.contact.id).toBe(provider.id);
  for (const device of [adult, admin])
    expect((await device.get(`/api/objects/${object.id}/accounts`)).json<Account[]>()).toHaveLength(
      3,
    );
  expect((await child.get(`/api/objects/${object.id}`)).status).toBe(404);
  expect((await child.get(`/api/objects/${object.id}/accounts`)).status).toBe(404);
  expect((await child.get(`/api/accounts/${ids[0]}`)).status).toBe(404);
  expect((await child.get(`/api/contacts/${provider.id}`)).status).toBe(200);
  expect((await child.get(`/api/records/contact/${provider.id}/links`)).json()).toEqual([]);
  const rows = (
    await world.database.admin.query('SELECT count(*)::int n FROM deadlines WHERE object_id=$1', [
      object.id,
    ])
  ).rows;
  expect(rows[0].n).toBe(0);
  expect((await property()).typeData).toEqual({});
  expect((await property(adult, { placement: { spaceId: world.houseId } })).audience).toBe(
    'adults',
  );
});
it('UTIL-1: прежний запрос без placement сохраняет «Только я», включая поля недвижимости', async () => {
  for (const typeData of [undefined, { address: 'Личный вымышленный адрес' }]) {
    const object = await property(adult, { placement: undefined, typeData });
    expect(object.spaceId).toBe(world.boris.personalSpaceId);
    expect(object.audience).toBeNull();
    for (const device of [admin, child])
      expect((await device.get(`/api/objects/${object.id}`)).status).toBe(404);
  }
});
it('UTIL-1: правка полей, поиск адреса и кадастра, скрытая недвижимость не попадает ребёнку', async () => {
  const object = await property();
  const result = await adult.request('PATCH', `/api/objects/${object.id}`, {
    json: {
      typeData: {
        address: 'Вымышленный переулок Уникальный, 9',
        cadastralNumber: '66:41:9999999:98765',
        areaHundredths: 9999,
      },
      expectedUpdatedAt: object.updatedAt,
    },
  });
  expect(result.status, result.text).toBe(200);
  expect(result.json<Property>().typeData.areaHundredths).toBe(9999);
  for (const q of ['Уникальный', '66:41:9999999:98765']) {
    const found = (await adult.get(`/api/search?q=${encodeURIComponent(q)}`)).json<{
      groups: { items: { id: string }[] }[];
    }>();
    expect(found.groups.flatMap((group) => group.items).some((item) => item.id === object.id)).toBe(
      true,
    );
    expect(
      (await child.get(`/api/search?q=${encodeURIComponent(q)}`)).json<{ total: number }>().total,
    ).toBe(0);
  }
  for (const typeData of [
    { areaHundredths: 1.23 },
    { cadastralNumber: 'bad' },
    { ownerMemberIds: [randomUUID()] },
  ])
    expect(
      (await adult.request('PATCH', `/api/objects/${object.id}`, { json: { typeData } })).status,
    ).toBe(400);
  expect(
    (
      await admin.request('PATCH', `/api/objects/${object.id}`, {
        json: { title: 'Вклад другого участника' },
      })
    ).status,
  ).toBe(200);
  expect((await adult.post(`/api/objects/${object.id}/personal`, { confirmed: true })).status).toBe(
    403,
  );
});
it('CONT-2: фильтр, правка, конфликт, корзина, восстановление; ребёнок не пишет организации', async () => {
  const provider = await contact(adult, { data: { organizationType: 'bank' } });
  const listed = (await adult.get('/api/contacts?organizationType=bank')).json<Contact[]>();
  expect(listed.map((row) => row.id)).toContain(provider.id);
  expect((await child.post('/api/contacts', { title: 'Нельзя' })).status).toBe(403);
  expect(
    (await child.request('PATCH', `/api/contacts/${provider.id}`, { json: { title: 'Нельзя' } }))
      .status,
  ).toBe(403);
  const updated = await admin.request('PATCH', `/api/contacts/${provider.id}`, {
    json: {
      title: 'Вымышленный банк',
      data: { organizationType: 'bank', website: 'https://bank.invalid' },
      expectedUpdatedAt: provider.updatedAt,
    },
  });
  expect(updated.status, updated.text).toBe(200);
  expect(
    (
      await adult.request('PATCH', `/api/contacts/${provider.id}`, {
        json: { title: 'Устаревшее', expectedUpdatedAt: provider.updatedAt },
      })
    ).status,
  ).toBe(409);
  expect((await adult.request('DELETE', `/api/contacts/${provider.id}`)).status).toBe(200);
  expect(
    (await adult.get('/api/contacts?organizationType=bank')).json<Contact[]>().map((row) => row.id),
  ).not.toContain(provider.id);
  expect(
    (await adult.get('/api/contacts?organizationType=bank&trash=true'))
      .json<Contact[]>()
      .map((row) => row.id),
  ).toContain(provider.id);
  expect((await admin.post(`/api/contacts/${provider.id}/restore`)).status).toBe(200);
});
it('UTIL-2: правка, отдельная корзина, перенос и копия вместе с объектом', async () => {
  const object = await property();
  const supplier = await contact();
  const own = await account(object.id, adult, {
    supplierId: supplier.id,
    data: {
      number: 'KEEP-123',
      transmission: { method: 'provider', url: 'https://supplier.invalid' },
    },
  });
  const personal = await adult.post(`/api/objects/${object.id}/personal`, { confirmed: true });
  expect(personal.status, personal.text).toBe(200);
  expect((await adult.get(`/api/accounts/${own.id}`)).json<Account>().spaceId).toBe(
    world.boris.personalSpaceId,
  );
  expect((await admin.get(`/api/accounts/${own.id}`)).status).toBe(404);
  expect(
    (
      await adult.post(`/api/objects/${object.id}/share`, {
        spaceId: world.houseId,
        audience: 'adults',
      })
    ).status,
  ).toBe(200);
  const foreign = await account(object.id, admin);
  expect((await adult.post(`/api/accounts/${own.id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/objects/${object.id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/accounts/${foreign.id}/restore`)).status).toBe(403);
  expect((await adult.post(`/api/objects/${object.id}/restore`)).status).toBe(200);
  expect((await adult.get(`/api/accounts/${foreign.id}`)).json<Account>().deletedAt).toBeNull();
  expect((await adult.get(`/api/accounts/${own.id}`)).json<Account>().deletedAt).not.toBeNull();
  expect((await adult.post(`/api/accounts/${own.id}/restore`)).status).toBe(200);
  const update = await adult.request('PATCH', `/api/accounts/${own.id}`, {
    json: { data: { number: 'KEEP-999', payer: 'tenant' } },
  });
  expect(update.status, update.text).toBe(200);
  expect(update.json<Account>().data.payer).toBe('tenant');
  expect((await adult.post(`/api/objects/${object.id}/personal`, { confirmed: true })).status).toBe(
    403,
  );
  const copy = await adult.post(`/api/objects/${object.id}/copy`);
  expect(copy.status, copy.text).toBe(201);
  const copies = (await adult.get(`/api/objects/${copy.json<Property>().id}/accounts`)).json<
    Account[]
  >();
  expect(copies).toHaveLength(2);
  expect(
    copies.some((row) => row.data.number === 'KEEP-999' && row.supplierId === supplier.id),
  ).toBe(true);
});
it('OBJ-2: собственник-контакт виден только вместе с обоими концами; скрытый поставщик — null', async () => {
  const object = await property(adult, {
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const owner = await contact(adult, {
    title: 'Вымышленный собственник',
    placement: { spaceId: world.boris.personalSpaceId },
  });
  const linked = await adult.post('/api/links', {
    left: { type: 'object', id: object.id },
    right: { type: 'contact', id: owner.id },
    role: 'собственник',
  });
  expect(linked.status, linked.text).toBe(201);
  const own = await account(object.id, adult, { supplierId: owner.id });
  for (const device of [admin, child]) {
    const provider = (await device.get(`/api/accounts/${own.id}`)).json<Account>();
    expect(provider.supplierId).toBeNull();
    expect(provider.supplier).toBeNull();
    expect(provider.supplierHidden).toBe(true);
    expect((await device.get(`/api/objects/${object.id}`)).text).not.toContain(owner.id);
    expect((await device.get(`/api/contacts/${owner.id}`)).status).toBe(404);
  }
  expect((await adult.get(`/api/objects/${object.id}`)).text).toContain(owner.id);
  expect(
    (await child.request('PATCH', `/api/accounts/${own.id}`, { json: { title: 'Нельзя' } })).status,
  ).toBe(403);
  const bad = await admin.request('PATCH', `/api/accounts/${own.id}`, {
    json: { supplierId: owner.id },
  });
  expect(bad.status).toBe(404);
  expect(bad.text).not.toContain(owner.id);
  const edited = await admin.request('PATCH', `/api/accounts/${own.id}`, {
    json: { supplierId: null, title: 'Исправленный счёт' },
  });
  expect(edited.status, edited.text).toBe(200);
  expect(edited.json<Account>().supplierId).toBeNull();
  expect((await adult.get(`/api/accounts/${own.id}`)).json<Account>().supplierId).toBe(owner.id);
  const cleared = await adult.request('PATCH', `/api/accounts/${own.id}`, {
    json: { supplierId: null },
  });
  expect(cleared.status, cleared.text).toBe(200);
  expect(cleared.json<Account>().supplierId).toBeNull();
  expect(cleared.json<Account>().supplierHidden).toBe(false);
  const copy = await child.post(`/api/objects/${object.id}/copy`);
  expect(copy.status, copy.text).toBe(201);
  expect(
    (await child.get(`/api/objects/${copy.json<Property>().id}/accounts`)).json<Account[]>()[0]
      ?.supplierId,
  ).toBeNull();
});
it('журналы не содержат адреса, номера счёта и текста организации', () => {
  expect(world.requestLog.join('\n')).not.toMatch(
    /Вымышленный проспект|KEEP-123|KEEP-999|TEST-maintenance|Вымышленная УК/,
  );
});

it('UTIL-1: уход собственника из дома не запрещает правку сохранённой недвижимости', async () => {
  const owner = await provisionAccount(world.fixtures, {
    username: 'fictional-owner',
    displayName: 'Вымышленный собственник',
    password: 'fictional-owner-pass',
    householdId: world.houseId,
    role: 'adult',
  });
  const object = await property(adult, {
    typeData: { ownerMemberIds: [owner.id, world.boris.id], areaHundredths: 5731 },
  });
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE account_id=$1',
    [owner.id],
  );
  const title = await adult.request('PATCH', `/api/objects/${object.id}`, {
    json: { title: 'Обновлённая квартира' },
  });
  expect(title.status, title.text).toBe(200);
  const fields = await adult.request('PATCH', `/api/objects/${object.id}`, {
    json: { typeData: { ownerMemberIds: [owner.id, world.boris.id], areaHundredths: 10000 } },
  });
  expect(fields.status, fields.text).toBe(200);
  const copy = await adult.post(`/api/objects/${object.id}/copy`);
  expect(copy.status, copy.text).toBe(201);
  expect(copy.json<Property>().typeData).toEqual({
    ownerMemberIds: [world.boris.id],
    areaHundredths: 10000,
  });
  expect(
    (await adult.get(`/api/objects/${object.id}`)).json<Property>().typeData.ownerMemberIds,
  ).toEqual([owner.id, world.boris.id]);
});

it('UTIL-1: копия из другого дома отбрасывает недоступного собственника', async () => {
  const houseId = await createHousehold(world.fixtures, 'Другой вымышленный дом');
  await world.database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
    [houseId, world.boris.id],
  );
  const member = await provisionAccount(world.fixtures, {
    username: 'fictional-copy-member',
    displayName: 'Вымышленный участник другого дома',
    password: 'fictional-copy-member-pass',
    householdId: houseId,
    role: 'adult',
  });
  const device = world.device();
  await device.signIn('fictional-copy-member', 'fictional-copy-member-pass');
  const object = await property(adult, {
    placement: { spaceId: world.boris.personalSpaceId },
    typeData: { ownerMemberIds: [world.anna.id, world.boris.id], areaHundredths: 5731 },
  });
  const shared = await adult.post(`/api/objects/${object.id}/share`, {
    spaceId: houseId,
    audience: 'adults',
  });
  expect(shared.status, shared.text).toBe(200);
  const copy = await device.post(`/api/objects/${object.id}/copy`);
  expect(copy.status, copy.text).toBe(201);
  expect(copy.json<Property>().spaceId).toBe(member.personalSpaceId);
  expect(copy.json<Property>().typeData).toEqual({
    ownerMemberIds: [world.boris.id],
    areaHundredths: 5731,
  });
});
it('API экранов: своё личное пространство, scope организаций и общая корзина счетов под RLS', async () => {
  expect((await adult.get('/api/me')).json<{ personalSpaceId: string }>().personalSpaceId).toBe(
    world.boris.personalSpaceId,
  );
  const own = await contact(adult, { placement: { spaceId: world.boris.personalSpaceId } });
  const common = await contact();
  const personal = (await adult.get('/api/contacts?scope=personal')).json<Contact[]>();
  expect(personal.map((r) => r.id)).toContain(own.id);
  expect(personal.map((r) => r.id)).not.toContain(common.id);
  expect((await adult.get('/api/contacts?scope=household')).text).not.toContain(own.id);
  expect((await admin.get('/api/contacts?scope=personal')).text).not.toContain(own.id);
  const hidden = await property();
  const visible = await property(adult, {
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const a = await account(hidden.id);
  const b = await account(visible.id);
  expect((await adult.post(`/api/objects/${hidden.id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/accounts/${b.id}/trash`)).status).toBe(200);
  const trash = (await adult.get('/api/accounts?trash=true')).json<Account[]>();
  expect(trash.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  const kidTrash = (await child.get('/api/accounts?trash=true')).json<Account[]>();
  expect(kidTrash.map((r) => r.id)).toContain(b.id);
  expect(kidTrash.map((r) => r.id)).not.toContain(a.id);
});
