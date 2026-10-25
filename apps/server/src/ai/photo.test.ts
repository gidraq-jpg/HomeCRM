import { readFile } from 'node:fs/promises';
import { MeterPhotoDraft, ReceiptPhotoDraft } from '@homecrm/shared';
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

it('UTIL-9: ответ модели не привязывает чужой счёт; сумма строкой переводится сервером', () => {
  const f = <T>(value: T) => ({ value, confident: true });
  const request: ExtractRequest = {
    kind: 'receipt',
    context: {
      objects: [],
      members: [],
      timeZone: 'UTC',
      accounts: [{ id: '11111111-1111-4111-8111-111111111111', number: 'TEST-777' }],
    },
  };
  const result = ReceiptPhotoDraft.parse(
    normalizeResponse(
      {
        supplier: f('Учебный поставщик'),
        accountId: f('22222222-2222-4222-8222-222222222222'),
        period: f('2026-09'),
        total: f('1 234,56 руб.'),
        dueOn: f('2026-10-25'),
      },
      request,
    ),
  );
  expect(result.totalCents.value).toBe(123456);
  expect(result.accountId).toEqual({ value: null, confident: false });
  const allowed = request.context.accounts?.[0];
  if (!allowed) throw new Error('Missing fixture');
  const ambiguous = ReceiptPhotoDraft.parse(
    normalizeResponse(
      {
        supplier: f('Учебное'),
        accountId: f(allowed.id),
        period: f('2026-09'),
        total: f('1234,56'),
        dueOn: f('2026-10-25'),
      },
      {
        ...request,
        context: {
          ...request.context,
          accounts: [
            allowed,
            { id: '33333333-3333-4333-8333-333333333333', number: allowed.number },
          ],
        },
      },
    ),
  );
  expect(ambiguous.accountId).toEqual({ value: null, confident: false });
});
