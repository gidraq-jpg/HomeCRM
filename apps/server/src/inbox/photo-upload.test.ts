import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INBOX_MAX_BYTES } from '@homecrm/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import { createWorld, type World } from '../testing/world.ts';

let directory: string;
let world: World;
let storage: DirectoryStorage;
const cipher = new FileCipher(randomBytes(32), 1);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'homecrm-inbox-photo-'));
  storage = new DirectoryStorage(directory);
  world = await createWorld({ files: { storage, cipher } });
});

afterAll(async () => {
  await world?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('INBOX-1: сбой записи виден безопасно, повтор сохраняет тот же элемент', async () => {
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  const id = randomUUID();
  const name = 'Вымышленное закрытое фото.heic';
  const text = 'Вымышленный закрытый текст';
  const bytes = await readFile(new URL('../files/fixtures/pattern.heic', import.meta.url));
  const base64 = bytes.toString('base64');
  const input = {
    id,
    idempotencyKey: id,
    ownerAccountId: world.boris.id,
    offline: true,
    source: 'photo',
    text,
    houseId: world.houseId,
    consent: null,
    files: [{ name, base64 }],
  };
  const invalid = await adult.post('/api/inbox', {
    ...input,
    files: [{ name, base64: `${base64.slice(0, -4)}A===` }],
  });
  expect(invalid.status).toBe(400);

  const put = vi
    .spyOn(storage, 'put')
    .mockRejectedValueOnce(new TypeError(`${name} ${text} ${base64}`));
  try {
    expect((await adult.post('/api/inbox', input)).status).toBe(500);
    expect(put).toHaveBeenCalledTimes(1);
  } finally {
    put.mockRestore();
  }
  const log = world.requestLog.join('');
  expect(log).toContain('"errorClass":"TypeError"');
  for (const secret of [name, text, base64.slice(0, 100)]) expect(log).not.toContain(secret);
  expect(
    (await world.database.admin.query('SELECT id FROM inbox_items WHERE id=$1', [id])).rowCount,
  ).toBe(0);

  const repeat = await adult.post('/api/inbox', input);
  expect(repeat.status, repeat.text).toBe(201);
  expect(repeat.json()).toMatchObject({ id, receipt: { key: id } });
  expect((await adult.post('/api/inbox', input)).json()).toEqual(repeat.json());
  expect(
    (await world.database.admin.query('SELECT id FROM inbox_files WHERE parent_id=$1', [id]))
      .rowCount,
  ).toBe(1);
});

it.each(['jpeg', 'heic', 'camera.jpeg'])(
  'INBOX-1: захват %s и повтор с тем же ID',
  async (format) => {
    const adult = world.device();
    await adult.signIn(world.boris.username, world.boris.password);
    const id = randomUUID();
    const width = 4000;
    const height = 3000;
    const bytes =
      format === 'heic'
        ? await readFile(new URL('../files/fixtures/pattern.heic', import.meta.url))
        : format === 'camera.jpeg'
          ? await sharp(
              createHash('shake256', { outputLength: width * height * 3 })
                .update('inbox-camera')
                .digest(),
              { raw: { width, height, channels: 3 } },
            )
              .jpeg({ quality: 91 })
              .toBuffer()
          : await sharp({ create: { width: 64, height: 48, channels: 3, background: 'white' } })
              .jpeg()
              .toBuffer();
    if (format === 'camera.jpeg') {
      expect(bytes.length).toBeGreaterThan(INBOX_MAX_BYTES * 0.95);
      expect(bytes.length).toBeLessThanOrEqual(INBOX_MAX_BYTES);
    }
    const input = {
      id,
      idempotencyKey: id,
      ownerAccountId: world.boris.id,
      offline: true,
      clientActedAt: new Date().toISOString(),
      source: 'photo',
      text: '',
      houseId: world.houseId,
      consent: null,
      files: [{ name: `Учебное фото.${format}`, base64: bytes.toString('base64') }],
    };
    const response = await adult.post('/api/inbox', input);
    expect(response.status, response.text).toBe(201);
    const repeat = await adult.post('/api/inbox', input);
    expect(repeat.status, repeat.text).toBe(201);
    expect(repeat.json()).toEqual(response.json());
    const { rows } = await world.database.admin.query(
      'SELECT mime_type,storage_key,envelope,preview_storage_key,preview_envelope FROM inbox_files WHERE parent_id=$1',
      [id],
    );
    expect(rows).toHaveLength(1);
    const file = rows[0];
    expect(file.mime_type).toBe('image/jpeg');
    const photo = cipher.open(await storage.get(file.storage_key), file.envelope, file.storage_key);
    const preview = cipher.open(
      await storage.get(file.preview_storage_key),
      file.preview_envelope,
      file.preview_storage_key,
    );
    const metadata = await sharp(photo).metadata();
    expect(metadata.format).toBe('jpeg');
    if (format === 'camera.jpeg') expect(metadata).toMatchObject({ width, height });
    expect((await sharp(preview).metadata()).format).toBe('webp');
  },
);
