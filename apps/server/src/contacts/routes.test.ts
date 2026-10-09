import { sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device, child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => world?.close());
type Contact = {
  id: string;
  spaceKind: string;
  audience: string;
  updatedAt: string;
  data: Record<string, unknown>;
  organizationId: string | null;
  actions: {
    phones: { href: string }[];
    emails: { href: string }[];
    messengers: { href: string }[];
    mapAddress: string;
  };
};
async function person(extra: Record<string, unknown> = {}, device = adult) {
  const response = await device.post('/api/contacts', {
    title: 'Вымышленный человек',
    kind: 'person',
    ...extra,
  });
  expect(response.status, response.text).toBe(201);
  return response.json<Contact>();
}
it('CONT-1/2/5: личное по умолчанию, закрытые категории, организация и нормализованные действия', async () => {
  const org = (
    await adult.post('/api/contacts', {
      title: 'Вымышленная организация',
      data: {
        website: 'https://example.test',
        openingHours: '9–18',
        phones: [{ number: '+7 900 000-00-00', label: 'Аварийная' }],
      },
    })
  ).json<{ id: string }>();
  const row = await person({
    organizationId: org.id,
    data: {
      categories: ['friend'],
      birthday: '--02-29',
      phones: [{ number: '+7 (900) 000-00-01' }],
      emails: ['test@example.test'],
      messengers: [{ url: 'https://t.me/example_test' }],
      address: 'Вымышленная улица, 1',
    },
  });
  expect(row).toMatchObject({
    spaceKind: 'personal',
    organizationId: org.id,
    data: { birthday: '--02-29' },
    actions: {
      phones: [{ href: 'tel:+79000000001' }],
      emails: [{ href: 'mailto:test@example.test' }],
      messengers: [{ href: 'https://t.me/example_test' }],
      mapAddress: 'Вымышленная улица, 1',
    },
  });
  expect((await admin.get(`/api/contacts/${row.id}`)).status).toBe(404);
  expect((await child.get('/api/contacts')).text).not.toContain(row.id);
  for (const data of [
    { categories: ['invented'] },
    { birthday: '--02-30' },
    { birthday: '2025-02-29' },
    { messengers: [{ url: 'javascript:alert(1)' }] },
  ])
    expect(
      (await adult.post('/api/contacts', { title: 'Вымышленный', kind: 'person', data })).status,
    ).toBe(400);
  const worker = await person({ data: { categories: ['craftsperson'] } });
  expect(worker).toMatchObject({ spaceKind: 'household', audience: 'household' });
  expect((await adult.get(`/api/contacts/${org.id}`)).json()).toMatchObject({
    data: { openingHours: '9–18', phones: [{ label: 'Аварийная' }] },
  });
});
it('CONT-1/3: роль связи, люди в объекте, скрытая организация не раскрывается в списке и истории', async () => {
  const org = (
    await adult.post('/api/contacts', {
      title: 'Вымышленная скрытая организация',
      placement: { spaceId: world.boris.personalSpaceId },
    })
  ).json<{ id: string }>();
  const row = await person({
    organizationId: org.id,
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const object = (
    await adult.post('/api/objects', {
      title: 'Вымышленный объект людей',
      placement: { spaceId: world.houseId, audience: 'household' },
    })
  ).json<{ id: string }>();
  expect(
    (
      await adult.post('/api/links', {
        left: { type: 'object', id: object.id },
        right: { type: 'contact', id: row.id },
        role: 'Сосед',
      })
    ).status,
  ).toBe(201);
  expect((await admin.get(`/api/objects/${object.id}`)).json()).toMatchObject({
    peopleAndOrganizations: [{ role: 'Сосед', contact: { kind: 'person' } }],
  });
  const response = await admin.get(`/api/contacts/${row.id}`);
  expect(response.json()).toMatchObject({ organization: null, organizationId: null });
  expect(response.text).not.toContain(org.id);
  expect((await admin.get('/api/contacts?kind=person')).text).not.toContain(org.id);
  expect((await admin.get(`/api/contacts/${row.id}/history`)).text).not.toContain(org.id);
  const changed = await adult.request('PATCH', `/api/contacts/${row.id}`, {
    json: { organizationId: null },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await adult.get(`/api/contacts/${row.id}/history`)).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ changes: { organization_changed: { new: true } } }),
    ]),
  );
});
it('CONT-3: оба порядка связи исключают из блока объекта контакт и связь в корзине', async () => {
  const response = await adult.post('/api/objects', {
    title: 'Вымышленный объект корзины контактов',
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(response.status, response.text).toBe(201);
  const object = response.json<{ id: string }>();
  const people = async () =>
    (await admin.get(`/api/objects/${object.id}`))
      .json<{
        peopleAndOrganizations: { contact: { id: string } }[];
      }>()
      .peopleAndOrganizations.map((item) => item.contact.id);
  for (const trash of ['contact', 'link'])
    for (const reverse of [false, true]) {
      const contact = await person({
        placement: { spaceId: world.houseId, audience: 'household' },
      });
      const objectRef = { type: 'object', id: object.id },
        contactRef = { type: 'contact', id: contact.id };
      const created = await adult.post('/api/links', {
        left: reverse ? contactRef : objectRef,
        right: reverse ? objectRef : contactRef,
        role: 'Сосед',
      });
      expect(created.status, created.text).toBe(201);
      expect(await people()).toContain(contact.id);
      const link = created.json<{ id: string }>();
      const removed = await adult.post(
        trash === 'contact' ? `/api/contacts/${contact.id}/trash` : `/api/links/${link.id}/trash`,
        {},
      );
      expect(removed.status, removed.text).toBe(200);
      expect(await people()).not.toContain(contact.id);
    }
});

it('CONT-4: лента объекта требует оба конца, ребёнок не видит взрослые взаимодействия', async () => {
  const object = (
    await adult.post('/api/objects', {
      title: 'Вымышленный общий объект',
      placement: { spaceId: world.houseId, audience: 'household' },
    })
  ).json<{ id: string }>();
  const personal = await person();
  const response = await adult.post(`/api/contacts/${personal.id}/interactions`, {
    kind: 'work',
    occurredOn: '2026-10-09',
    text: 'Вымышленная частная работа',
    amountCents: 12345,
    callAgain: true,
    objectId: object.id,
  });
  expect(response.status, response.text).toBe(201);
  const interaction = response.json<{ id: string }>();
  expect((await adult.get(`/api/objects/${object.id}/timeline`)).json()).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({
        source: 'interaction',
        amountCents: 12345,
        contactId: personal.id,
      }),
    ]),
  });
  expect((await admin.get(`/api/objects/${object.id}/timeline`)).text).not.toContain(
    interaction.id,
  );
  expect((await child.get(`/api/objects/${object.id}/timeline`)).text).not.toContain(
    interaction.id,
  );
  const adults = await person({ placement: { spaceId: world.houseId, audience: 'adults' } });
  const adultsInteraction = await adult.post(`/api/contacts/${adults.id}/interactions`, {
    kind: 'call',
    occurredOn: '2026-10-09',
    text: 'Вымышленный взрослый звонок',
    objectId: object.id,
  });
  expect(adultsInteraction.status, adultsInteraction.text).toBe(201);
  expect((await child.get(`/api/contacts/${adults.id}/interactions`)).status).toBe(404);
  expect((await child.get(`/api/objects/${object.id}/timeline`)).text).not.toContain(
    adultsInteraction.json<{ id: string }>().id,
  );
  const hidden = (
    await adult.post('/api/objects', {
      title: 'Вымышленный личный объект',
      placement: { spaceId: world.boris.personalSpaceId },
    })
  ).json<{ id: string }>();
  const shared = await person({ placement: { spaceId: world.houseId, audience: 'household' } });
  expect(
    (
      await adult.post(`/api/contacts/${shared.id}/interactions`, {
        kind: 'visit',
        occurredOn: '2026-10-09',
        text: 'Вымышленный визит',
        objectId: hidden.id,
      })
    ).status,
  ).toBe(201);
  const feed = await admin.get(`/api/contacts/${shared.id}/interactions`);
  expect(feed.json()).toMatchObject([{ object: null, objectId: null }]);
  expect(feed.text).not.toContain(hidden.id);
  const event = feed.json<{ id: string }[]>()[0];
  expect(event).toBeDefined();
  const changed = await adult.request(
    'PATCH',
    `/api/contacts/${shared.id}/interactions/${event?.id}`,
    {
      json: { kind: 'visit', occurredOn: '2026-10-09', text: 'Вымышленный визит', objectId: null },
    },
  );
  expect(changed.status, changed.text).toBe(200);
  const history = await admin.get(`/api/contacts/${shared.id}/interactions/${event?.id}/history`);
  expect(history.text).not.toContain(hidden.id);
  expect(history.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ changes: { object_changed: { new: true } } }),
    ]),
  );
});
it('CONT-4: независимая корзина, каскад восстановления и переноса, вклад другого блокирует приватизацию', async () => {
  const row = await person();
  const create = async (text: string, device = adult) =>
    (
      await device.post(`/api/contacts/${row.id}/interactions`, {
        kind: 'message',
        occurredOn: '2026-10-09',
        text,
      })
    ).json<{ id: string }>();
  const independent = await create('Вымышленное независимое сообщение'),
    childRow = await create('Вымышленное каскадное сообщение');
  expect(
    (await adult.post(`/api/contacts/${row.id}/interactions/${independent.id}/trash`, {})).status,
  ).toBe(200);
  expect((await adult.post(`/api/contacts/${row.id}/trash`, {})).status).toBe(200);
  expect((await adult.post(`/api/contacts/${row.id}/restore`, {})).status).toBe(200);
  expect((await adult.get(`/api/contacts/${row.id}/interactions`)).json()).toMatchObject([
    { id: childRow.id },
  ]);
  expect(
    (
      await adult.post(`/api/contacts/${row.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await adult.get(`/api/contacts/${row.id}/interactions?trash=true`)).json()).toMatchObject(
    [{ id: independent.id, spaceKind: 'household', audience: 'adults' }],
  );
  const edit = await admin.request('PATCH', `/api/contacts/${row.id}/interactions/${childRow.id}`, {
    json: {
      kind: 'work',
      occurredOn: '2026-10-09',
      text: 'Вымышленный вклад другого взрослого',
      amountCents: 100,
    },
  });
  expect(edit.status, edit.text).toBe(200);
  expect(
    (
      await adult.post(`/api/contacts/${row.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (await adult.get(`/api/contacts/${row.id}/interactions/${childRow.id}/history`)).json<
      unknown[]
    >(),
  ).not.toHaveLength(0);
});
it('CONT-1: поиск индексирует только имя и название организации; корзина и личное скрыты', async () => {
  const row = await person({
    title: 'Вымышленный Синеволков',
    data: {
      phones: [{ number: '+7 900 111-22-33' }],
      emails: ['private@example.test'],
      address: 'Вымышленный Скрытоадрес',
      note: 'Вымышленный Скрытозаметка',
    },
  });
  expect((await adult.get('/api/search?q=Синеволков')).text).toContain(row.id);
  expect((await admin.get('/api/search?q=Синеволков')).text).not.toContain(row.id);
  for (const q of ['79001112233', 'private@example.test', 'Скрытоадрес', 'Скрытозаметка'])
    expect((await adult.get(`/api/search?q=${encodeURIComponent(q)}`)).text).not.toContain(row.id);
  await adult.post(`/api/contacts/${row.id}/trash`, {});
  expect((await adult.get('/api/search?q=Синеволков')).text).not.toContain(row.id);
  await adult.post(`/api/contacts/${row.id}/restore`, {});
  expect((await adult.get('/api/search?q=Синеволков')).text).toContain(row.id);
  const result = await world.module.appDb
    .withAccount(world.boris.id, (tx) => tx.execute(sql`SELECT app.refresh_passport_birthday()`))
    .catch(() => null);
  expect(result).toBeNull();
});

it('CONT-1/4: журналы не содержат ФИО, контакты, адрес, сумму и текст взаимодействия', async () => {
  const phone = '+79991112233',
    email = 'fictional.private@example.test',
    address = 'Вымышленный Секретоадрес',
    name = 'Вымышленный Секретофамильцев',
    text = 'Вымышленное Секретовзаимодействие';
  const row = await person({
    title: name,
    data: { phones: [{ number: phone }], emails: [email], address },
  });
  const response = await adult.post(`/api/contacts/${row.id}/interactions`, {
    kind: 'work',
    occurredOn: '2026-10-09',
    text,
    amountCents: 87654321,
  });
  expect(response.status, response.text).toBe(201);
  await adult.get(`/api/contacts/${row.id}`);
  await adult.get(`/api/contacts/${row.id}/interactions`);
  const logs = [...world.logs, ...world.requestLog].join('\n');
  for (const value of [phone, email, address, name, text, '87654321'])
    expect(logs).not.toContain(value);
});
