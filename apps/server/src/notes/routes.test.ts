import { randomUUID } from 'node:crypto';
import { canViewSql, tasks } from '@homecrm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from '../auth/provision.ts';
import type { Device, Reply } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let second: Device;
let child: Device;
let admin: Device;
type Card = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorId: string;
  spaceId: string;
  spaceKind: string;
  audience: string | null;
  deletedAt: string | null;
  updatedAt: string;
  checklist: { id: string; title: string; done: boolean; deletedAt: string | null }[];
};
const base = '/api/notes';
const common = () => ({ spaceId: world.houseId, audience: 'household' });
async function create(device = adult, payload: Record<string, unknown> = {}): Promise<Card> {
  const result = await device.post(base, { title: 'Вымышленная заметка', ...payload });
  expect(result.status).toBe(201);
  return result.json<Card>();
}
const patch = (device: Device, id: string, body: unknown) =>
  device.request('PATCH', `${base}/${id}`, { json: body });
const status = (reply: Reply, expected: number) => expect(reply.status).toBe(expected);
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  second = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  const person = await provisionAccount(world.fixtures, {
    username: 'sergey',
    displayName: 'Сергей',
    password: 'fictional-sergey-pass',
    householdId: world.houseId,
    role: 'adult',
  });
  expect(person.id).toBeTruthy();
  await second.signIn('sergey', 'fictional-sergey-pass');
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
describe('NOTE-1…3, SPACE-7: API заметок', () => {
  it('по умолчанию личная, Markdown и чек-лист сохраняются, закрепление и правка работают', async () => {
    const note = await create(adult, {
      body: '**Важно**\n- список',
      checklist: [{ title: 'Первый' }],
    });
    expect(note.spaceKind).toBe('personal');
    expect(note.authorId).toBe(world.boris.id);
    expect(note.body).toBe('**Важно**\n- список');
    expect(note.checklist).toHaveLength(1);
    const result = await patch(adult, note.id, {
      title: 'Новая заметка',
      pinned: true,
      checklist: [{ id: note.checklist[0]?.id, title: 'Первый', done: true }, { title: 'Второй' }],
    });
    status(result, 200);
    expect(result.json<Card>().pinned).toBe(true);
    expect(result.json<Card>().checklist.map((item) => item.done)).toEqual([true, false]);
    expect((await adult.get(`${base}/${note.id}`)).json<Card>().title).toBe('Новая заметка');
  });
  it('второй взрослый, ребёнок и администратор не видят даже id чужого личного', async () => {
    const note = await create();
    for (const device of [second, child, admin]) {
      status(await device.get(`${base}/${note.id}`), 404);
      expect(
        (await device.get(base)).json<{ id: string }[]>().some((row) => row.id === note.id),
      ).toBe(false);
      status(await device.post(`${base}/${note.id}/access-preview`, { action: 'personal' }), 404);
      status(await device.post(`${base}/${note.id}/copy`, {}), 404);
    }
  });
  it('проверка в коде скрывает чужое личное даже при испорченной политике чтения', async () => {
    const note = await create();
    try {
      await world.database.admin.query('ALTER POLICY notes_select ON notes USING (true)');
      status(await admin.get(`${base}/${note.id}`), 404);
      status(await child.post(`${base}/${note.id}/copy`, {}), 404);
      expect(
        (await admin.get(base)).json<{ id: string }[]>().some((row) => row.id === note.id),
      ).toBe(false);
      const exported = await admin.post('/api/export', { password: world.anna.password });
      status(exported, 200);
      expect(exported.json<{ notes: Card[] }>().notes.some((row) => row.id === note.id)).toBe(
        false,
      );
    } finally {
      await world.database.admin.query(
        `ALTER POLICY notes_select ON notes USING (${canViewSql()})`,
      );
    }
  });
  it('ребёнок пишет своё личное, читает семейное и не видит «Взрослые»', async () => {
    const mine = await create(child);
    expect(mine.authorId).toBe(world.vera.id);
    status(await child.post(base, { title: 'В общее', placement: common() }), 403);
    const shared = await create(adult, { placement: common() });
    status(await child.get(`${base}/${shared.id}`), 200);
    status(await patch(child, shared.id, { title: 'Подмена' }), 403);
    const adults = await create(adult, { placement: { ...common(), audience: 'adults' } });
    status(await child.get(`${base}/${adults.id}`), 404);
  });
  it('поделиться переносит заметку и чек-лист, чужой владелец не переносит', async () => {
    const note = await create(adult, { checklist: [{ title: 'Пункт' }] });
    status(await second.post(`${base}/${note.id}/share`, common()), 404);
    status(await adult.post(`${base}/${note.id}/share`, common()), 200);
    expect((await child.get(`${base}/${note.id}`)).json<Card>().checklist).toHaveLength(1);
    const rows = await world.database.admin.query(
      'SELECT space_id, audience FROM note_items WHERE parent_id=$1',
      [note.id],
    );
    expect(rows.rows[0]).toMatchObject({ space_id: world.houseId, audience: 'household' });
  });
  it('сделать личной: только автор, подтверждение и отсутствие чужого вклада', async () => {
    const note = await create(adult, { placement: common(), checklist: [{ title: 'Пункт' }] });
    status(await second.post(`${base}/${note.id}/personal`, { confirmed: true }), 403);
    status(await adult.post(`${base}/${note.id}/personal`, {}), 400);
    const preview = await adult.post(`${base}/${note.id}/access-preview`, { action: 'personal' });
    status(preview, 200);
    const affected = preview.json<{ losesAccess: { displayName: string }[] }>().losesAccess;
    expect(affected.map((item) => item.displayName).sort()).toEqual(['Анна', 'Вера', 'Сергей']);
    status(await adult.post(`${base}/${note.id}/personal`, { confirmed: true }), 200);
    status(await admin.get(`${base}/${note.id}`), 404);
  });
  it('чужая правка запрещает сделать личной; копия не тянет автора и историю', async () => {
    const note = await create(adult, { placement: common(), checklist: [{ title: 'Пункт' }] });
    status(await patch(second, note.id, { body: 'Совместный вклад' }), 200);
    status(await adult.post(`${base}/${note.id}/personal`, { confirmed: true }), 403);
    const copied = await child.post(`${base}/${note.id}/copy`, {});
    status(copied, 201);
    const copy = copied.json<Card>();
    expect(copy.id).not.toBe(note.id);
    expect(copy.authorId).toBe(world.vera.id);
    expect(copy.body).toBe('Совместный вклад');
    expect(copy.checklist).toHaveLength(1);
    expect(
      (
        await world.database.admin.query('SELECT * FROM notes_history WHERE record_id=$1', [
          copy.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await world.database.admin.query(
          'SELECT h.* FROM note_items_history h JOIN note_items i ON h.record_id=i.id WHERE i.parent_id=$1',
          [copy.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('чужой вклад в чек-лист и удалённый пункт тоже запрещают сделать личной', async () => {
    const note = await create(adult, { placement: common(), checklist: [{ title: 'Пункт' }] });
    status(
      await patch(second, note.id, {
        checklist: [{ id: note.checklist[0]?.id, title: 'Изменён', done: true }],
      }),
      200,
    );
    status(await patch(adult, note.id, { checklist: [] }), 200);
    status(await adult.post(`${base}/${note.id}/personal`, { confirmed: true }), 403);
  });
  it('сужение показывает только теряющих доступ и требует подтверждения; история фиксирует смену', async () => {
    const note = await create(adult, { placement: common() });
    const preview = await second.post(`${base}/${note.id}/access-preview`, {
      action: 'audience',
      audience: 'adults',
    });
    expect(
      preview
        .json<{ losesAccess: { accountId: string }[] }>()
        .losesAccess.map((item) => item.accountId),
    ).toEqual([world.vera.id]);
    status(await second.post(`${base}/${note.id}/audience`, { audience: 'adults' }), 409);
    status(
      await second.post(`${base}/${note.id}/audience`, { audience: 'adults', confirmed: true }),
      200,
    );
    status(await child.get(`${base}/${note.id}`), 404);
    const events = await world.database.admin.query(
      'SELECT operation FROM notes_history WHERE record_id=$1 ORDER BY created_at',
      [note.id],
    );
    expect(events.rows.some((row) => row.operation === 'audience')).toBe(true);
  });
  it('сужение запрещено с ребёнком-ответственным до назначения взрослого', async () => {
    const note = await create(adult, { placement: common() });
    status(await patch(adult, note.id, { assigneeId: world.vera.id }), 200);
    status(
      await adult.post(`${base}/${note.id}/audience`, { audience: 'adults', confirmed: true }),
      409,
    );
    status(await patch(adult, note.id, { assigneeId: world.boris.id }), 200);
    status(
      await adult.post(`${base}/${note.id}/audience`, { audience: 'adults', confirmed: true }),
      200,
    );
  });
  it('корзина: дата базы, содержимое не меняют, взрослый-не-автор не восстанавливает', async () => {
    const note = await create(adult, { placement: common(), checklist: [{ title: 'Пункт' }] });
    const trashed = await second.post(`${base}/${note.id}/trash`, {});
    status(trashed, 200);
    expect(Date.now() - new Date(trashed.json<Card>().deletedAt ?? '').getTime()).toBeLessThan(
      5000,
    );
    status(await patch(adult, note.id, { title: 'В корзине' }), 403);
    status(await second.post(`${base}/${note.id}/restore`, {}), 403);
    status(await adult.post(`${base}/${note.id}/copy`, {}), 403);
    status(await admin.post(`${base}/${note.id}/restore`, {}), 200);
    expect((await adult.get(`${base}/${note.id}`)).json<Card>().checklist).toHaveLength(1);
  });
  it('контекст общего объекта наследует пространство и не расширяет «Взрослые»', async () => {
    const [object] = await world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx
        .insert(tasks)
        .values({
          spaceId: world.houseId,
          spaceKind: 'household',
          audience: 'adults',
          authorId: world.boris.id,
          title: 'Объект-пример',
        })
        .returning(),
    );
    const note = await create(adult, { object: { type: 'task', id: object?.id } });
    expect(note.spaceId).toBe(world.houseId);
    expect(note.audience).toBe('adults');
    status(
      await adult.post(base, {
        title: 'Расширение',
        object: { type: 'task', id: object?.id },
        placement: common(),
      }),
      403,
    );
    status(
      await child.post(base, { title: 'Чужой объект', object: { type: 'task', id: object?.id } }),
      404,
    );
    status(
      await adult.post(base, {
        title: 'Неизвестный объект',
        object: { type: 'task', id: randomUUID() },
      }),
      404,
    );
  });
  it('границы: неизвестные поля, пустой заголовок и подмена автора отклоняются', async () => {
    status(await adult.post(base, { title: '' }), 400);
    status(await adult.post(base, { title: 'Подмена', authorId: world.anna.id }), 400);
    const note = await create();
    status(await patch(adult, note.id, { spaceId: world.houseId }), 400);
    status(await patch(adult, note.id, { hasOtherContributions: false }), 400);
    status(await adult.get(`${base}/not-a-uuid`), 400);
  });
  it('ошибочный чужой id чек-листа откатывает и правку заголовка', async () => {
    const note = await create();
    status(
      await patch(adult, note.id, {
        title: 'Не сохранится',
        checklist: [{ id: randomUUID(), title: 'Чужой' }],
      }),
      400,
    );
    expect((await adult.get(`${base}/${note.id}`)).json<Card>().title).toBe(note.title);
  });
  it('устаревшая версия возвращает конфликт', async () => {
    const note = await create();
    status(
      await patch(adult, note.id, {
        title: 'Устаревшая',
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      }),
      409,
    );
  });
  it('без сессии, без Origin и до TOTP администратора записи закрыты', async () => {
    status(await world.device().get(base), 401);
    status(await adult.post(base, { title: 'Без Origin' }, { origin: null }), 403);
    // Обязательный TOTP проверяется общим reader: незавершённый вход сессии не даёт.
    const pending = world.device();
    await pending.signIn(world.anna.username, world.anna.password);
    status(await pending.get(base), 401);
  });
  it('экспорт содержит Markdown и чек-лист; взрослый не выгружает общее и чужое личное', async () => {
    const mine = await create(adult, {
      body: '**Текст экспорта**',
      checklist: [{ title: 'Пункт' }, { title: 'Удалённый пункт' }],
    });
    status(
      await patch(adult, mine.id, {
        checklist: [{ id: mine.checklist[0]?.id, title: 'Пункт' }],
      }),
      200,
    );
    const shared = await create(adult, { placement: common() });
    const reply = await adult.post('/api/export', { password: world.boris.password });
    status(reply, 200);
    const list = reply.json<{ notes: Card[] }>().notes;
    expect(list.find((row) => row.id === mine.id)).toMatchObject({
      body: '**Текст экспорта**',
      checklist: [{ title: 'Пункт' }, { title: 'Удалённый пункт' }],
    });
    expect(list.find((row) => row.id === mine.id)?.checklist[1]?.deletedAt).not.toBeNull();
    expect(list.some((row) => row.id === shared.id)).toBe(false);
    const commonExport = await admin.post('/api/export', { password: world.anna.password });
    status(commonExport, 200);
    expect(commonExport.json<{ notes: Card[] }>().notes.some((row) => row.id === mine.id)).toBe(
      false,
    );
    expect(commonExport.json<{ notes: Card[] }>().notes.some((row) => row.id === shared.id)).toBe(
      true,
    );
  });
  it('при сбое базы в ответе и журналах нет ни Markdown, ни заголовка, ни Failed query', async () => {
    const title = 'Sensitive fictional title';
    const body = 'Sensitive fictional Markdown';
    await world.database.admin.query(`CREATE FUNCTION public.test_notes_error() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% %', NEW.title, NEW.body USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER notes_zz_error BEFORE INSERT ON notes FOR EACH ROW EXECUTE FUNCTION public.test_notes_error()`);
    try {
      const failed = await adult.post(base, { title, body });
      status(failed, 500);
      await adult.get(`${base}?title=${encodeURIComponent(title)}`);
      const output = world.requestLog.join('') + failed.text;
      expect(output).not.toContain(title);
      expect(output).not.toContain(body);
      expect(output).not.toContain('Failed query');
      expect(world.requestLog.join('')).toContain('Notes request failed');
    } finally {
      await world.database.admin.query(
        'DROP TRIGGER notes_zz_error ON notes; DROP FUNCTION public.test_notes_error()',
      );
    }
  });
  it('поиск подготовлен колонкой; worker и auth не получают заметки', async () => {
    const note = await create(adult, { body: 'текст поиска' });
    const data = await world.database.admin.query('SELECT search_text FROM notes WHERE id=$1', [
      note.id,
    ]);
    expect(data.rows[0].search_text).toContain('текст поиска');
    await expect(world.database.auth.query('SELECT body FROM notes')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(world.database.worker.query('SELECT body FROM notes')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
