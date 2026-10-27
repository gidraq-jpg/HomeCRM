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
  expect(
    await parseInbox({ extract, health: async () => true }, pdf.text, pdf.images, context),
  ).toBeNull();
  expect(extract.mock.calls.map(([input]) => input.kind)).toEqual(['identity']);
});
it.each(['yes', 'unsure'] as const)(
  'AI-4: %s останавливает все извлечения и не сохраняет ответ',
  async (identity) => {
    const extract = vi.fn(async () => ({ identity }));
    const result = await parseInbox(
      { extract, health: async () => true },
      'Учебный документ',
      [Buffer.from('page-1'), Buffer.from('page-2')],
      context,
    );
    expect(result).toBeNull();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]).toBeDefined();
  },
);
it('AI-4: личность на последней странице запрещает извлечение со всех страниц', async () => {
  const kinds: string[] = [];
  const extract = vi.fn(async (input: ExtractRequest) => {
    kinds.push(input.kind);
    return { identity: kinds.length === 3 ? ('unsure' as const) : ('no' as const) };
  });
  expect(
    await parseInbox(
      { extract, health: async () => true },
      'Учебный договор',
      [Buffer.from('a'), Buffer.from('b')],
      context,
    ),
  ).toBeNull();
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
