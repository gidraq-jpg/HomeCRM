import {
  AutoDrafts,
  DraftSchemas,
  localDate,
  meterDecimal,
  meterUnits,
  parseQuickline,
  type TaskDraft,
} from '@homecrm/shared';
import { z } from 'zod';
import type { ExtractRequest } from './providers.ts';

const whenText = z.strictObject({ value: z.string().max(500).nullable(), confident: z.boolean() });
export const RawTask = DraftSchemas.task.omit({ date: true, time: true }).extend({ whenText });
const RawAuto = z
  .array(
    z.discriminatedUnion('kind', [
      RawTask.extend({ kind: z.literal('task') }),
      DraftSchemas.shopping.element.extend({ kind: z.literal('shopping') }),
      DraftSchemas.note.extend({ kind: z.literal('note') }),
    ]),
  )
  .min(1)
  .max(10);
export const ResponseSchemas = {
  meter: z.strictObject({
    values: z
      .array(z.strictObject({ value: z.string().max(50).nullable(), confident: z.boolean() }))
      .min(1)
      .max(3),
  }),
  identity: DraftSchemas.identity,
  task: RawTask,
  shopping: z.strictObject({ items: DraftSchemas.shopping }),
  note: DraftSchemas.note,
  auto: z.strictObject({ items: RawAuto }),
};

export function taskDates(raw: z.infer<typeof whenText>, input: ExtractRequest) {
  // «к 18» — тот же срок, что «в 18»; поведение обычной быстрой строки не меняем.
  const text = (raw.value ?? '').replace(/(?<![\p{L}\p{N}])к\s+(?=\d)/giu, 'в ');
  const result = parseQuickline(text, {
    now: input.context.now ?? new Date(),
    timeZone: input.context.timeZone,
    members: [],
    objects: [],
  });
  return {
    date: { value: result.planOn, confident: raw.confident && result.planOn !== null },
    time: { value: result.planTime, confident: raw.confident && result.planTime !== null },
  };
}
export function normalizeTask(raw: z.infer<typeof RawTask>, input: ExtractRequest): TaskDraft {
  const { whenText, ...task } = raw;
  for (const [key, entries] of [
    ['assigneeId', input.context.members],
    ['objectId', input.context.objects.slice(0, 50)],
  ] as const) {
    if (!entries.some((entry) => entry.id === task[key].value))
      task[key] = { value: null, confident: false };
  }
  return { ...task, ...taskDates(whenText, input) };
}
export function normalizeResponse(value: unknown, input: ExtractRequest) {
  if (input.kind === 'identity') return DraftSchemas.identity.parse(value);
  if (input.kind === 'meter') {
    const raw = ResponseSchemas.meter.parse(value);
    const meter = input.context.meter;
    if (!meter || raw.values.length !== meter.zones.length)
      throw new Error('Invalid meter context');
    return DraftSchemas.meter.parse({
      values: raw.values.map((field) => {
        try {
          let text = field.value?.replace(/\s/g, '').replace(',', '.');
          if (!text) throw new Error('Unreadable display');
          if (!text.includes('.') && meter.fractionDigits) {
            if (text.length !== meter.integerDigits + meter.fractionDigits)
              throw new Error('Ambiguous precision');
            text = `${text.slice(0, -meter.fractionDigits)}.${text.slice(-meter.fractionDigits)}`;
          }
          return {
            value: meterDecimal(meterUnits(text, meter), meter.fractionDigits),
            confident: field.confident,
          };
        } catch {
          return { value: null, confident: false };
        }
      }),
    });
  }
  if (input.kind === 'task') return normalizeTask(RawTask.parse(value), input);
  if (input.kind === 'auto')
    return AutoDrafts.parse(
      ResponseSchemas.auto
        .parse(value)
        .items.map((row) =>
          row.kind === 'task' ? { ...normalizeTask(row, input), kind: 'task' } : row,
        ),
    );
  if (input.kind === 'shopping') return ResponseSchemas.shopping.parse(value).items;
  return DraftSchemas.note.parse(value);
}
// API проверяет ExtractInput.consent=true до чтения контекста и вызова поставщика.
// Здесь остаются только данные из п. 2 D25; eval использует вымышленную семью.
export function requestContext(input: ExtractRequest) {
  if (input.kind === 'identity') return {};
  if (input.kind === 'meter') return { meter: input.context.meter };
  const now = input.context.now ?? new Date();
  const line = (value: string) => value.replace(/[\r\n]+/g, ' ');
  return {
    today: `${localDate(now, input.context.timeZone)} ${new Intl.DateTimeFormat('ru', { weekday: 'long', timeZone: input.context.timeZone }).format(now)}`,
    members: input.context.members.map((m) => `${m.id}: ${line(m.name)}`).join('\n'),
    objects: input.context.objects
      .slice(0, 50)
      .map((o) => `${o.id}: ${line(o.title)}`)
      .join('\n'),
  };
}
