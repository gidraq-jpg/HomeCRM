import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { readPdf } from '../ai/pdf.ts';
import { type ExtractRequest, fakeDraft } from '../ai/providers.ts';
import { parseInbox } from './parse.ts';

const context = { objects: [], members: [], timeZone: 'Asia/Yekaterinburg' };
it('AI-4: из вымышленного PDF личности не извлекается ни одного поля', async () => {
  const pdf = await readPdf(
    await readFile(new URL('../ai/eval/samples/pdf/identity.pdf', import.meta.url)),
  );
  const extract = vi.fn(async (input: ExtractRequest) => fakeDraft(input));
  await expect(
    parseInbox({ extract, health: async () => true }, pdf.text, pdf.images, context),
  ).rejects.toMatchObject({ status: 422, code: 'AI_PRIVATE_DOCUMENT' });
  expect(extract.mock.calls.map(([input]) => input.kind)).toEqual(['identity']);
});
it.each(['no', 'unsure'] as const)('AI-4: %s разрешает разбор всех страниц', async (identity) => {
  const extract = vi.fn(async (input: ExtractRequest) =>
    input.kind === 'identity' ? { identity } : fakeDraft(input),
  );
  const result = await parseInbox(
    { extract, health: async () => true },
    'Учебный договор',
    [Buffer.from('page-1'), Buffer.from('page-2')],
    context,
  );
  expect(result.classification.kind).toBe('document');
  expect(extract.mock.calls.map(([input]) => input.kind)).toEqual([
    'identity',
    'identity',
    'identity',
    'inbox',
    'document',
  ]);
});
it('AI-4: личность на последней странице запрещает извлечение со всех страниц', async () => {
  const kinds: string[] = [];
  const extract = vi.fn(async (input: ExtractRequest) => {
    kinds.push(input.kind);
    return { identity: kinds.length === 3 ? ('yes' as const) : ('no' as const) };
  });
  await expect(
    parseInbox(
      { extract, health: async () => true },
      'Учебный договор',
      [Buffer.from('a'), Buffer.from('b')],
      context,
    ),
  ).rejects.toMatchObject({ status: 422, code: 'AI_PRIVATE_DOCUMENT' });
  expect(kinds).toEqual(['identity', 'identity', 'identity']);
});
it('INBOX-3: неизвестные UUID не проходят в черновик, все шаги делят один срок', async () => {
  const hidden = randomUUID(),
    deadlines: (number | undefined)[] = [];
  const extract = vi.fn(async (input: ExtractRequest) => {
    deadlines.push(input.deadline);
    if (input.kind === 'inbox')
      return {
        shoppingText: null,
        kind: 'task' as const,
        objectId: { value: hidden, confident: true },
        personId: { value: hidden, confident: true },
        meterId: { value: hidden, confident: true },
        newObject: null,
      };
    return fakeDraft(input);
  });
  const result = await parseInbox({ extract, health: async () => true }, 'Позвонить', [], context);
  expect(result?.classification.objectId).toEqual({ value: null, confident: false });
  expect(result?.classification.personId.value).toBeNull();
  expect(result?.classification.meterId.value).toBeNull();
  expect(new Set(deadlines).size).toBe(1);
});
it('INBOX-2: чужой или отсутствующий счётчик не разбирается', async () => {
  const extract = vi.fn(async (input: ExtractRequest) =>
    input.kind === 'inbox'
      ? {
          kind: 'meter' as const,
          shoppingText: null,
          objectId: { value: null, confident: false },
          personId: { value: null, confident: false },
          meterId: { value: randomUUID(), confident: true },
          newObject: null,
        }
      : fakeDraft(input),
  );
  await expect(
    parseInbox({ extract, health: async () => true }, 'Табло', [], context),
  ).rejects.toMatchObject({ code: 'AI_METER_REQUIRED' });
  expect(extract.mock.calls.map(([i]) => i.kind)).toEqual(['identity', 'inbox']);
});
