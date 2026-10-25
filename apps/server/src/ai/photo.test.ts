import { readFile } from 'node:fs/promises';
import { MeterPhotoDraft } from '@homecrm/shared';
import { expect, it } from 'vitest';
import { normalizeResponse } from './drafts.ts';
import type { ExtractRequest } from './providers.ts';
import { preparePhoto } from './providers.ts';

const input: ExtractRequest = {
  kind: 'meter',
  context: {
    objects: [],
    members: [],
    timeZone: 'UTC',
    meter: {
      resource: 'cold_water',
      zones: ['Основная'],
      integerDigits: 5,
      fractionDigits: 3,
      previous: null,
    },
  },
};
it.each([
  ['00123456', '123.456'],
  ['00123,456', '123.456'],
  ['12.3', '12.300'],
  ['00 123,456', '123.456'],
  ['99999.999', '99999.999'],
  ['12345', null],
  ['100000.000', null],
  ['1.2345', null],
  ['номер 456', null],
  [null, null],
])('UTIL-4: табло %s преобразуется точно по разрядности', (text, expected) => {
  const draft = MeterPhotoDraft.parse(
    normalizeResponse({ values: [{ value: text, confident: true }] }, input),
  );
  expect(draft.values[0]?.value).toBe(expected);
  if (expected === null) expect(draft.values[0]?.confident).toBe(false);
});
it('UTIL-4: три зоны и целое табло; пропущенные зоны не угадываются', () => {
  const f = (value: string) => ({ value, confident: false });
  const request = {
    ...input,
    context: {
      ...input.context,
      meter: {
        resource: 'electricity' as const,
        integerDigits: 5,
        previous: null,
        zones: ['Т1', 'Т2', 'Т3'],
        fractionDigits: 0,
      },
    },
  };
  expect(normalizeResponse({ values: [f('00012'), f('345'), f('00200')] }, request)).toEqual({
    values: [f('12'), f('345'), f('200')],
  });
  expect(() => normalizeResponse({ values: [f('00012')] }, request)).toThrow(
    'Invalid meter context',
  );
});
it('AI-5: подготовка фото снимает метаданные и ограничивает размер', async () => {
  const sharp = (await import('sharp')).default;
  const original = await sharp(
    await readFile(new URL('./eval/samples/meters/1.jpg', import.meta.url)),
  )
    .resize(2400)
    .withMetadata({ exif: { IFD0: { ImageDescription: 'Вымышленное описание' } } })
    .jpeg()
    .toBuffer();
  const result = await preparePhoto(original);
  const meta = await sharp(result).metadata();
  expect(meta.format).toBe('jpeg');
  expect(Math.max(meta.width, meta.height)).toBe(1600);
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
});
