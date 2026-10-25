import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DocumentDraft, MeterData } from '@homecrm/shared';
import sharp from 'sharp';
import { z } from 'zod';
import { type InboxContext, parseInbox } from '../../inbox/parse.ts';
import { document } from '../prompts/document.ts';
import { inbox } from '../prompts/inbox.ts';
import type { createProviders } from '../providers.ts';
import { context } from './cases.ts';

const flat = context.objects[1].id,
  dacha = context.objects[0].id;
const meterId = '66666666-6666-4666-8666-666666666666';
/** PNG сохраняет пиксели готового синтетического образца D26 при загрузке файлов. */
export async function identityPage(index = 1) {
  return sharp(await readFile(new URL(`./samples/identity/${index}.jpg`, import.meta.url)))
    .png()
    .toBuffer();
}
export async function meterPage() {
  return sharp(await readFile(new URL('./samples/meters/1.jpg', import.meta.url)))
    .png()
    .toBuffer();
}
const Sample = z.object({
  text: z.string().default(''),
  image: z.string().optional(),
  render: z.boolean().optional(),
  kind: z.string(),
  objectId: z.uuid().nullable().default(null),
  fields: z.record(z.string(), z.unknown()).optional(),
  extraKinds: z.array(z.string()).optional(),
});
export const inboxSamples: z.input<typeof Sample>[] = [
  { text: 'Завтра вызвать электрика на Дачу', kind: 'task', objectId: dacha },
  { text: 'В пятницу в 18 проверить кран, Квартира на Лунной', kind: 'task', objectId: flat },
  { text: 'Позвонить в мастерскую завтра утром', kind: 'task' },
  { text: 'Купить молоко 2 литра', kind: 'shopping' },
  { text: 'Купить батарейки AA 4 штуки', kind: 'shopping' },
  { text: 'Купить яблоки 1 кг', kind: 'shopping' },
  {
    text: 'Заметка: код учебной калитки на Даче — 0000, вымышленный',
    kind: 'note',
    objectId: dacha,
  },
  { text: 'Заметка: цвет стены — учебный синий, Квартира на Лунной', kind: 'note', objectId: flat },
  {
    text: 'Учебный договор обслуживания. Объект: Дача. Дата выдачи 2026-10-01. Действует до 2027-10-01. Цена 1000 рублей.',
    render: true,
    kind: 'document',
    objectId: dacha,
    fields: { type: 'contract', issuedOn: '2026-10-01', expiresOn: '2027-10-01' },
  },
  {
    text: 'Учебная гарантия и чек на насос. Объект: Дача. Дата выдачи 2026-09-01. Действует до 2028-09-01.',
    render: true,
    kind: 'document',
    objectId: dacha,
    fields: { type: 'warranty_receipt', issuedOn: '2026-09-01', expiresOn: '2028-09-01' },
  },
  {
    text: 'Учебный полис ОСАГО автомобиля. Выдан 2026-10-01. Действует до 2027-09-30. Вымышленный страхователь Анна.',
    render: true,
    kind: 'document',
    fields: { type: 'osago', issuedOn: '2026-10-01', expiresOn: '2027-09-30' },
  },
  {
    text: 'Учебная выписка ЕГРН. Объект: Квартира на Лунной. Выдана 2026-10-20. Бессрочно.',
    render: true,
    kind: 'document',
    objectId: flat,
    fields: { type: 'egrn', issuedOn: '2026-10-20', expiresOn: null },
  },
  {
    text: 'Учебный анализ крови. Вымышленная Анна. Выдан 2026-10-10. Гемоглобин 130 г/л.',
    render: true,
    kind: 'medical',
    fields: { type: 'medical', issuedOn: '2026-10-10' },
  },
  {
    text: 'Табло счётчика воды Дачи показывает 00123.456. Это показание, не задача.',
    kind: 'meter',
    objectId: dacha,
  },
  {
    text: 'Учебная квитанция об оплате ЖКХ. Объект: Дача. Лицевой счёт 9900000010. Сентябрь 2026. Начислено 1234,56 руб. Оплатить до 2026-10-25.',
    render: true,
    kind: 'receipt',
    objectId: dacha,
  },
  {
    text: 'Купить учебный блокнот и заметка: гарантия насоса лежит в ящике.',
    kind: 'note',
    extraKinds: ['shopping'],
  },
  {
    text: 'Учебный договор обслуживания Дачи, выдан 2026-10-01, действует до 2027-10-01. Отдельно купить держатель для папки.',
    kind: 'document',
    objectId: dacha,
    fields: { type: 'contract', issuedOn: '2026-10-01', expiresOn: '2027-10-01' },
    extraKinds: ['shopping'],
  },
  { text: 'Заметка: новый объект: Учебный насос; гарантия в учебной коробке.', kind: 'note' },
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'identity', image: `../identity/${i + 1}.jpg` })),
];
export async function evaluateInbox(
  providers: ReturnType<typeof createProviders>,
  fake: boolean,
  prompts = { inbox, document },
) {
  const index = process.argv.indexOf('--samples');
  const directory =
    index < 0 ? join(import.meta.dirname, 'samples/inbox') : resolve(process.argv[index + 1] ?? '');
  const all =
    index < 0
      ? inboxSamples.map((s) => Sample.parse(s))
      : z.array(Sample).parse(JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8')));
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? all.length);
  const samples = all.slice(0, limit);
  const ctx: InboxContext = {
    ...context,
    accounts: [{ id: '77777777-7777-4777-8777-777777777777', number: '9900000010' }],
    meters: [{ id: meterId, title: 'Счётчик воды Дача' }],
    meterData: new Map([
      [
        meterId,
        {
          ...MeterData.parse({ resource: 'cold_water', integerDigits: 5, fractionDigits: 3 }),
          previous: null,
        },
      ],
    ]),
  };
  const result = {
    mode: fake ? 'contract' : 'quality',
    samples: 0,
    failed: 0,
    kind: { correct: 0, total: 0 },
    object: { correct: 0, total: 0 },
    document: { correct: 0, total: 0 },
    identity: { correct: 0, total: 0 },
    mixed: { correct: 0, total: 0 },
    missed: [] as number[],
    promptLengths: { inbox: prompts.inbox.length, document: prompts.document.length },
    stopped: false,
  };
  for (const [i, sample] of samples.entries()) {
    let text = sample.text;
    const images: Buffer[] = [];
    if (sample.image) images.push(await readFile(join(directory, sample.image)));
    if (sample.render) {
      const lines = sample.text.match(/.{1,70}(?:\s|$)|.{1,70}/gu) ?? [sample.text];
      images.push(
        await sharp(
          Buffer.from(
            `<svg width="1400" height="900"><rect width="1400" height="900" fill="white"/>${lines.map((line, n) => `<text x="50" y="${80 + n * 50}" font-size="28" fill="black">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')}</svg>`,
          ),
        )
          .png()
          .toBuffer(),
      );
      text = '';
    }
    if (fake && sample.kind === 'identity') text = 'Учебный паспорт';
    let correct = true;
    try {
      const draft = await parseInbox(providers.extractor, text, images, ctx);
      if (sample.kind === 'identity') {
        result.identity.total++;
        if (draft === null) result.identity.correct++;
        else correct = false;
      } else {
        for (const kind of sample.extraKinds ?? []) {
          result.mixed.total++;
          if (fake || draft?.additional.some((entry) => entry.classification.kind === kind))
            result.mixed.correct++;
          else correct = false;
        }
        result.kind.total++;
        result.object.total++;
        if (fake || draft?.classification.kind === sample.kind) result.kind.correct++;
        else correct = false;
        if (fake || draft?.classification.objectId.value === sample.objectId)
          result.object.correct++;
        else correct = false;
        if (sample.fields) {
          const fields = DocumentDraft.safeParse(draft?.fields);
          for (const [name, expected] of Object.entries(sample.fields)) {
            result.document.total++;
            const field = fields.success
              ? fields.data[name as 'type' | 'issuedOn' | 'expiresOn']
              : undefined;
            if (fake || field?.value === expected) result.document.correct++;
            else correct = false;
          }
        }
      }
    } catch (error) {
      result.failed++;
      correct = false;
      if (
        error instanceof Error &&
        'code' in error &&
        ['AI_BUSY', 'AI_QUOTA'].includes(String(error.code))
      ) {
        result.stopped = true;
        break;
      }
    }
    result.samples++;
    if (!correct) result.missed.push(i + 1);
  }
  console.log(JSON.stringify(result));
  if (
    result.stopped ||
    result.failed ||
    result.kind.correct / (result.kind.total || 1) < 0.9 ||
    result.object.correct / (result.object.total || 1) < 0.85 ||
    result.document.correct / (result.document.total || 1) < 0.85 ||
    result.identity.correct !== result.identity.total ||
    result.mixed.correct !== result.mixed.total
  )
    process.exitCode = 1;
}
