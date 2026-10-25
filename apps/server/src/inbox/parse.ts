import {
  AutoDrafts,
  DraftSchemas,
  IdentityCheck,
  InboxClassification,
  InboxDraft,
  InboxEntry,
  type MeterData,
} from '@homecrm/shared';
import type { Extractor, ExtractRequest } from '../ai/providers.ts';
import { Failure } from '../objects/support.ts';

export type InboxContext = ExtractRequest['context'] & {
  meterData?: ReadonlyMap<string, MeterData & { previous: string[] | null }>;
};
/** Все страницы проходят барьер ДО первого запроса с извлечением полей. */
export async function parseInbox(
  extractor: Extractor,
  text: string,
  images: Buffer[],
  context: InboxContext,
  deadline = Date.now() + 120000,
): Promise<InboxDraft | null> {
  const base = { context, deadline };
  const sources: Pick<ExtractRequest, 'text' | 'image'>[] = [
    ...(text.trim() ? [{ text }] : []),
    ...images.map((bytes) => ({ image: { bytes, classification: 'ordinary' as const } })),
  ];
  if (!sources.length) throw new Failure(422, 'AI_INVALID_RESPONSE');
  for (const source of sources) {
    const check = IdentityCheck.parse(
      await extractor.extract({
        ...base,
        ...source,
        kind: 'identity',
        context: { objects: [], members: [], timeZone: context.timeZone },
      }),
    );
    if (check.identity !== 'no') return null;
  }
  const input: Omit<ExtractRequest, 'kind'> = {
    ...base,
    text,
    ...(images[0]
      ? {
          image: { bytes: images[0], classification: 'ordinary' },
          images: images.slice(1).map((bytes) => ({ bytes, classification: 'ordinary' as const })),
        }
      : {}),
  };
  const classification = InboxClassification.parse(
    await extractor.extract({ ...input, kind: 'inbox' }),
  );
  // Проверяем UUID и при fake/стороннем Extractor, не только в адаптере Hermes.
  for (const [field, entries] of [
    ['objectId', context.objects],
    ['personId', context.members],
    ['meterId', context.meters ?? []],
  ] as const) {
    if (!entries.some((e) => e.id === classification[field].value))
      classification[field] = { value: null, confident: false };
  }
  const kind =
    classification.kind === 'medical'
      ? 'document'
      : classification.kind === 'meter'
        ? 'meter'
        : classification.kind;
  if (kind === 'task' || kind === 'shopping' || kind === 'note') {
    const mixed = AutoDrafts.parse(await extractor.extract({ ...input, kind: 'auto' }));
    const entries = mixed.map(({ kind, ...fields }) =>
      InboxEntry.parse({
        classification: {
          ...classification,
          kind,
          objectId:
            'objectId' in fields && fields.objectId.value
              ? fields.objectId
              : classification.objectId,
        },
        fields: kind === 'shopping' ? [fields] : fields,
      }),
    );
    const first = entries.find((entry) => entry.classification.kind !== 'shopping') ?? entries[0];
    if (!first) throw new Failure(422, 'AI_INVALID_RESPONSE');
    return InboxDraft.parse({
      ...first,
      additional: entries
        .filter((entry) => entry !== first)
        .map((entry) => ({
          ...entry,
          classification: { ...entry.classification, newObject: null },
        })),
    });
  }
  if (kind === 'meter') {
    const meter = context.meterData?.get(classification.meterId.value ?? '');
    if (!meter) throw new Failure(422, 'AI_METER_REQUIRED', 'Выберите счётчик в обычной форме.');
    input.context = { ...context, meter };
  }
  const fields = DraftSchemas[kind].parse(await extractor.extract({ ...input, kind }));
  const additional = classification.shoppingText
    ? [
        {
          classification: { ...classification, kind: 'shopping', newObject: null },
          fields: DraftSchemas.shopping.parse(
            await extractor.extract({
              ...base,
              kind: 'shopping',
              text: classification.shoppingText,
            }),
          ),
        },
      ]
    : [];
  return InboxDraft.parse({ classification, fields, additional });
}
