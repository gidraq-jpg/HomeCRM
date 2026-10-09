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
async function create(device: Device, path: string, body: Record<string, unknown>) {
  const response = await device.post(path, body);
  expect(response.status, response.text).toBe(201);
  return response.json<{ id: string }>();
}
const patch = (device: Device, path: string, body: Record<string, unknown>) =>
  device.request('PATCH', path, { json: body });

it('7a/SPACE-3: взрослый правит текст, null и пропущенные ссылки сохраняют чужие личные цели', async () => {
  const org = await create(admin, '/api/contacts', {
    title: 'Вымышленная закрытая организация',
    placement: { spaceId: world.anna.personalSpaceId },
  });
  const object = await create(admin, '/api/objects', { title: 'Вымышленный закрытый объект' });
  const person = await create(admin, '/api/contacts', {
    title: 'Вымышленный общий человек',
    kind: 'person',
    organizationId: org.id,
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const interaction = await create(admin, `/api/contacts/${person.id}/interactions`, {
    kind: 'visit',
    occurredOn: '2026-10-09',
    text: 'Вымышленный визит',
    objectId: object.id,
  });
  const document = await create(admin, '/api/documents', {
    title: 'Вымышленный общий документ',
    owner: { kind: 'contact', id: org.id },
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  for (const include of [false, true]) {
    const editedPerson = await patch(adult, `/api/contacts/${person.id}`, {
      title: 'Вымышленный исправленный человек',
      ...(include ? { organizationId: null } : {}),
    });
    expect(editedPerson.status, editedPerson.text).toBe(200);
    expect(editedPerson.json()).toMatchObject({ organizationId: null, organization: null });
    const editedInteraction = await patch(
      adult,
      `/api/contacts/${person.id}/interactions/${interaction.id}`,
      {
        kind: 'visit',
        occurredOn: '2026-10-09',
        text: 'Вымышленный исправленный визит',
        ...(include ? { objectId: null } : {}),
      },
    );
    expect(editedInteraction.status, editedInteraction.text).toBe(200);
    expect(editedInteraction.json()).toMatchObject({ objectId: null, object: null });
    const editedDocument = await patch(adult, `/api/documents/${document.id}`, {
      title: 'Вымышленный исправленный документ',
      ...(include ? { owner: null } : {}),
    });
    expect(editedDocument.status, editedDocument.text).toBe(200);
    expect(editedDocument.json()).toMatchObject({ owner: null });
    for (const response of [editedPerson, editedInteraction, editedDocument]) {
      expect(response.text).not.toContain(org.id);
      expect(response.text).not.toContain(object.id);
    }
    expect((await admin.get(`/api/contacts/${person.id}`)).json()).toMatchObject({
      organizationId: org.id,
    });
    expect((await admin.get(`/api/contacts/${person.id}/interactions`)).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: interaction.id, objectId: object.id }),
      ]),
    );
    expect((await admin.get(`/api/documents/${document.id}`)).json()).toMatchObject({
      owner: { kind: 'contact', id: org.id },
    });
  }
  const history = await adult.get(
    `/api/contacts/${person.id}/interactions/${interaction.id}/history`,
  );
  expect(history.text).not.toContain(object.id);
  expect(history.text).not.toContain('object_changed');
  const unchanged = await patch(adult, `/api/contacts/${person.id}`, { organizationId: null });
  expect(unchanged.status, unchanged.text).toBe(200);
  expect((await admin.get(`/api/contacts/${person.id}`)).json()).toMatchObject({
    organizationId: org.id,
  });
});

it('7a: видимую связь можно снять, пропущенная сохраняется; владелец документа неизменяем', async () => {
  const org = await create(adult, '/api/contacts', { title: 'Вымышленная видимая организация' });
  const person = await create(adult, '/api/contacts', {
    title: 'Вымышленный редактор',
    kind: 'person',
    organizationId: org.id,
  });
  const object = await create(adult, '/api/objects', { title: 'Вымышленный видимый объект' });
  const interaction = await create(adult, `/api/contacts/${person.id}/interactions`, {
    kind: 'call',
    occurredOn: '2026-10-09',
    text: 'Вымышленный звонок',
    objectId: object.id,
  });
  expect(
    (await patch(adult, `/api/contacts/${person.id}`, { title: 'Вымышленная правка' })).json(),
  ).toMatchObject({ organizationId: org.id });
  const body = { kind: 'call', occurredOn: '2026-10-09', text: 'Вымышленная правка звонка' };
  expect(
    (await patch(adult, `/api/contacts/${person.id}/interactions/${interaction.id}`, body)).json(),
  ).toMatchObject({ objectId: object.id });
  expect(
    (await patch(adult, `/api/contacts/${person.id}`, { organizationId: null })).json(),
  ).toMatchObject({ organizationId: null });
  expect(
    (
      await patch(adult, `/api/contacts/${person.id}/interactions/${interaction.id}`, {
        ...body,
        objectId: null,
      })
    ).json(),
  ).toMatchObject({ objectId: null });
  const document = await create(adult, '/api/documents', {
    title: 'Вымышленный документ владельца',
    owner: { kind: 'contact', id: person.id },
  });
  expect(
    (
      await patch(adult, `/api/documents/${document.id}`, {
        title: 'Вымышленная правка',
        owner: { kind: 'contact', id: person.id },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await patch(adult, `/api/documents/${document.id}`, {
        title: 'Вымышленная правка',
        owner: null,
      })
    ).json(),
  ).toMatchObject({ code: 'OWNER_IMMUTABLE' });
});

it('7a/DOC-4: expiryRule содержит точные 20/45 лет; явный срок и неизвестная дата без границы', async () => {
  for (const [birthday, issuedOn, years] of [
    ['2006-12-01', '2020-01-01', 20],
    ['1981-12-01', '2002-01-01', 45],
  ] as const) {
    const contact = await create(adult, '/api/contacts', {
      title: 'Вымышленный владелец паспорта',
      kind: 'person',
      data: { birthday },
    });
    const doc = await create(adult, '/api/documents', {
      title: 'Вымышленный паспорт по возрасту',
      owner: { kind: 'contact', id: contact.id },
      data: { type: 'russian_passport', issuedOn },
    });
    expect((await adult.get(`/api/documents/${doc.id}`)).json()).toMatchObject({
      expiryRule: { kind: 'window', date: '2026-12-01', passportYears: years },
    });
    const explicit = await patch(adult, `/api/documents/${doc.id}`, {
      data: { type: 'russian_passport', issuedOn, expiresOn: '2030-01-01' },
    });
    expect(explicit.status, explicit.text).toBe(200);
    expect(explicit.json<{ expiryRule: Record<string, unknown> }>().expiryRule).not.toHaveProperty(
      'passportYears',
    );
  }
  const unknown = await create(adult, '/api/documents', {
    title: 'Вымышленный неизвестный паспорт',
    data: { type: 'russian_passport' },
  });
  expect((await adult.get(`/api/documents/${unknown.id}`)).json()).toMatchObject({
    expiryRule: { kind: 'after', eventDate: null },
  });
});

it('7a/CONT-4: название контакта в ленте актуально, скрытие контакта скрывает всё взаимодействие', async () => {
  const contact = await create(adult, '/api/contacts', {
    title: 'Вымышленное имя ленты',
    kind: 'person',
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const object = await create(adult, '/api/objects', {
    title: 'Вымышленный объект ленты',
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const event = await create(adult, `/api/contacts/${contact.id}/interactions`, {
    kind: 'work',
    occurredOn: '2026-10-09',
    text: 'Вымышленная работа ленты',
    objectId: object.id,
  });
  const timeline = async () =>
    (await child.get(`/api/objects/${object.id}/timeline`)).json<{
      items: { interactionId?: string; contactTitle?: string }[];
    }>();
  expect((await timeline()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ interactionId: event.id, contactTitle: 'Вымышленное имя ленты' }),
    ]),
  );
  expect(
    (await patch(adult, `/api/contacts/${contact.id}`, { title: 'Вымышленное новое имя ленты' }))
      .status,
  ).toBe(200);
  expect((await timeline()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        interactionId: event.id,
        contactTitle: 'Вымышленное новое имя ленты',
      }),
    ]),
  );
  expect(
    (
      await adult.post(`/api/contacts/${contact.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await timeline()).items.some((row) => row.interactionId === event.id)).toBe(false);
});

it('7a/SRCH-1/4: глобальная группа контактов содержит оба вида и соблюдает scope и текущую аудиторию', async () => {
  const person = await create(adult, '/api/contacts', {
    title: 'Вымышленный Поискоякорев',
    kind: 'person',
    data: { note: 'Непоисковый секрет текста' },
  });
  const org = await create(adult, '/api/contacts', {
    title: 'Вымышленная Поискоякорев организация',
  });
  const find = async (device: Device, scope = 'all') => {
    const response = await device.get(
      `/api/search?q=${encodeURIComponent('Поискоякорев')}&scope=${scope}`,
    );
    expect(response.status, response.text).toBe(200);
    return response.json<{
      total: number;
      groups: { type: string; label: string; items: { id: string; targetId: string }[] }[];
    }>();
  };
  const ids = (result: Awaited<ReturnType<typeof find>>) =>
    result.groups.flatMap((group) => group.items.map((row) => row.id));
  expect(await find(adult)).toMatchObject({
    groups: expect.arrayContaining([
      expect.objectContaining({
        type: 'contact',
        label: 'Люди и организации',
        items: expect.arrayContaining([
          expect.objectContaining({ id: person.id, targetId: person.id }),
          expect.objectContaining({ id: org.id, targetId: org.id }),
        ]),
      }),
    ]),
  });
  expect(ids(await find(child))).toEqual([org.id]);
  expect(ids(await find(adult, 'personal'))).toEqual([person.id]);
  expect(ids(await find(adult, 'household'))).toEqual([org.id]);
  expect(
    (
      await adult.post(`/api/contacts/${org.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await find(child)).total).toBe(0);
  expect((await adult.post(`/api/contacts/${org.id}/trash`, {})).status).toBe(200);
  expect(ids(await find(adult))).toEqual([person.id]);
});
