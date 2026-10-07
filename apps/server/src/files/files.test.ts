import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadFilesConfig } from '../config.ts';
import { FileCipher, readMasterKey } from './crypto.ts';
import { MAX_FILE_BYTES, prepareFile, safeFilename } from './media.ts';
import { DirectoryStorage } from './storage.ts';

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-files-unit-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});
it('каждый блок и превью имеют отдельный ключ; чужой ключ, контекст и подмена отклоняются', () => {
  const cipher = new FileCipher(randomBytes(32), 3);
  const key = randomUUID();
  const source = Buffer.from('Вымышленный документ');
  const first = cipher.seal(source, key);
  const second = cipher.seal(source, key);
  expect(first.envelope).not.toEqual(second.envelope);
  expect(first.block).not.toEqual(second.block);
  expect(cipher.open(first.block, first.envelope, key)).toEqual(source);
  expect(() => new FileCipher(randomBytes(32), 3).open(first.block, first.envelope, key)).toThrow();
  expect(() => cipher.open(first.block, first.envelope, randomUUID())).toThrow();
  first.block[28] = (first.block[28] ?? 0) ^ 1;
  expect(() => cipher.open(first.block, first.envelope, key)).toThrow();
});
it('ключ обязателен, читается из файла; ошибки не содержат ключа или пути', async () => {
  expect(() => loadFilesConfig({})).toThrow(/FILE_MASTER_KEY_FILE/);
  const path = join(folder, 'master');
  const secret = randomBytes(32).toString('hex');
  await writeFile(path, secret);
  expect(await readMasterKey(path, 1)).toBeInstanceOf(FileCipher);
  await writeFile(path, `${secret}bad`);
  await expect(readMasterKey(path, 1)).rejects.not.toThrow(secret);
  await expect(readMasterKey(join(folder, 'missing'), 1)).rejects.toThrow(
    /^File encryption master key is missing, unreadable or invalid$/,
  );
});
it('дисковый блок не содержит исходник; имя не задаёт путь и существующий ключ не перезаписывается', async () => {
  const storage = new DirectoryStorage(folder);
  const key = randomUUID();
  const cipher = new FileCipher(randomBytes(32), 1);
  const data = Buffer.from('fictional private photo');
  const encrypted = cipher.seal(data, key);
  await storage.put(key, encrypted.block);
  expect((await readFile(join(folder, key))).includes(data)).toBe(false);
  await expect(storage.put(key, encrypted.block)).rejects.toThrow();
  await expect(storage.get('../master')).rejects.toThrow();
  await storage.delete(key);
  await expect(storage.get(key)).rejects.toThrow();
  expect(safeFilename('../a\\b\r\n.html')).not.toMatch(/[\\/\r\n]/);
});
it.each(['jpeg', 'png', 'webp'] as const)(
  'фото %s и превью перекодируются без EXIF, GPS и XMP',
  async (format) => {
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#aabbcc' },
    })
      .toFormat(format)
      .withExif({
        IFD0: { Artist: 'Fictional', Orientation: '6' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 1/1 1/1' },
      })
      .toBuffer();
    const result = await prepareFile(source);
    const meta = await sharp(result.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(result.preview).toBeDefined();
    expect((await sharp(result.preview).metadata()).exif).toBeUndefined();
  },
);
it('подмена типа и повреждённое фото отклоняются, лимит проверяется до декодирования', async () => {
  await expect(prepareFile(Buffer.from('<html>fake.jpg</html>'))).rejects.toMatchObject({
    status: 415,
  });
  await expect(prepareFile(Buffer.from([255, 216, 255, 0, 1]))).rejects.toMatchObject({
    status: 415,
  });
  await expect(prepareFile(Buffer.alloc(MAX_FILE_BYTES + 1))).rejects.toMatchObject({
    status: 413,
  });
  const pdf = Buffer.from('%PDF-1.7\nfictional\n%%EOF');
  expect((await prepareFile(pdf)).mimeType).toBe('application/pdf');
});

it('настоящий HEIC с вымышленной одноцветной картинкой декодируется в JPEG без метаданных', async () => {
  const input = await readFile(new URL('./fixtures/pattern.heic', import.meta.url));
  const output = await prepareFile(input);
  expect(output.mimeType).toBe('image/jpeg');
  const metadata = await sharp(output.data).metadata();
  expect(metadata.width).toBe(16);
  expect(metadata.height).toBe(16);
  expect(metadata.exif).toBeUndefined();
  expect((await sharp(output.preview).metadata()).format).toBe('webp');
});

it('HEIC с чрезмерными размерами отклоняется до выделения RGBA', async () => {
  const input = await readFile(new URL('./fixtures/pattern.heic', import.meta.url));
  const offset = input.indexOf(Buffer.from('ispe'));
  expect(offset).toBeGreaterThan(0);
  input.writeUInt32BE(400_000, offset + 8);
  input.writeUInt32BE(400_000, offset + 12);
  await expect(prepareFile(input)).rejects.toMatchObject({ status: 415 });
});

it('R0.5d: короткий GCM-тег обёртки ключа отклоняется', () => {
  const cipher = new FileCipher(randomBytes(32), 1),
    key = randomUUID();
  const sealed = cipher.seal(Buffer.from('Вымышленный файл'), key);
  const shortTag = {
    ...sealed.envelope,
    tag: Buffer.from(sealed.envelope.tag, 'base64').subarray(0, 4).toString('base64'),
  };
  expect(() => cipher.open(sealed.block, shortTag, key)).toThrow();
});
it('R0.5d: JPEG с предупреждением о лишних байтах принимается, тяжёлое повреждение отклоняется', async () => {
  const source = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#aabbcc' },
  })
    .jpeg()
    .toBuffer();
  const position = 4 + source.readUInt16BE(4);
  const minor = Buffer.concat([
    source.subarray(0, position),
    Buffer.from([1, 2, 3, 4]),
    source.subarray(position),
  ]);
  await expect(sharp(minor, { failOn: 'warning' }).toBuffer()).rejects.toThrow();
  const result = await prepareFile(minor);
  expect(await sharp(result.data).metadata()).toMatchObject({
    width: 32,
    height: 24,
    format: 'jpeg',
  });
  expect((await sharp(result.preview).metadata()).format).toBe('webp');
  await expect(prepareFile(source.subarray(0, 30))).rejects.toMatchObject({ status: 415 });
});
it('R0.5d: ICC сохраняется в фото и превью; EXIF и GPS удаляются', async () => {
  const source = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#aabbcc' },
  })
    .jpeg()
    .withIccProfile('p3')
    .withExif({
      IFD0: { Artist: 'Fictional' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 1/1 1/1' },
    })
    .toBuffer();
  const expected = (await sharp(source).metadata()).icc;
  expect(expected).toBeDefined();
  const result = await prepareFile(source);
  for (const data of [result.data, result.preview]) {
    const metadata = await sharp(data).metadata();
    expect(metadata.icc).toEqual(expected);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  }
});
