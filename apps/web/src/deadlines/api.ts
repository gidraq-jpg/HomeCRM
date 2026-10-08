import { AUDIENCES, DeadlineRule, RADAR_GROUPS } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import { MeterCard } from '../meters/api.ts';

// Сроки и радар — ADR-0028, apps/server/src/deadlines. Ответы проверяются схемами: сервер мог
// измениться, а экран не должен ломаться на неожиданной форме. Названия записей и сроков живут
// только в ответах и памяти страницы: в адреса, журнал, localStorage и кэш они не попадают.

export type SourceKind = 'notes' | 'objects';

/** Правило срока записи. Сервер отдаёт сохранённое правило, поэтому разбираем его той же схемой. */
export const DeadlineItem = z.object({
  id: z.string(),
  noteId: z.string().nullable(),
  objectId: z.string().nullable(),
  householdId: z.string(),
  rule: DeadlineRule,
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeadlineItem = z.infer<typeof DeadlineItem>;

export function fetchSourceDeadlines(source: SourceKind, id: string, signal?: AbortSignal) {
  return apiRequest('GET', `${source}/${id}/deadlines`, z.array(DeadlineItem), undefined, signal);
}

export function createDeadline(
  source: SourceKind,
  id: string,
  rule: DeadlineRule,
  householdId: string | null,
) {
  return apiRequest('POST', `${source}/${id}/deadlines`, DeadlineItem, {
    rule,
    // Для личной записи сервер должен знать, по поясу какого дома считать срок.
    ...(householdId === null ? {} : { householdId }),
  });
}

export function patchDeadline(id: string, rule: DeadlineRule) {
  return apiRequest('PATCH', `deadlines/${id}`, DeadlineItem, { rule });
}

export function trashDeadline(id: string) {
  return apiRequest('DELETE', `deadlines/${id}`, DeadlineItem);
}
export function restoreDeadline(id: string) {
  return apiRequest('POST', `deadlines/${id}/restore`, DeadlineItem, {});
}
export const TrashedDeadline = DeadlineItem.extend({ title: z.string(), canRestore: z.boolean() });
export type TrashedDeadline = z.infer<typeof TrashedDeadline>;
export function fetchTrashedDeadlines(signal?: AbortSignal) {
  return apiRequest('GET', 'deadlines/trash', z.array(TrashedDeadline), undefined, signal);
}

/** Вид источника срока (ADR-0033): прежний срок записи или управляемый срок счёта или счётчика. */
export const SOURCE_KINDS = ['record', 'readings', 'payment', 'verification', 'document'] as const;
export type UtilitySourceKind = Exclude<(typeof SOURCE_KINDS)[number], 'record' | 'document'>;

/** Основное действие пункта радара (docs/utility-deadlines-api.md). Подписи приходят с сервера. */
export const PrimaryAction = z.object({
  kind: z.enum(['enter_readings', 'mark_payment', 'verify_meter']),
  label: z.string(),
  objectId: z.string().nullish(),
  occurrenceId: z.string().nullish(),
  meterId: z.string().nullish(),
  /** Окно без счётчиков: «Добавьте счётчики». */
  hint: z.string().optional(),
  completionAction: z
    .object({ kind: z.literal('mark_readings'), label: z.string(), occurrenceId: z.string() })
    .optional(),
});
export type PrimaryAction = z.infer<typeof PrimaryAction>;

/**
 * Наступление несёт источник, название и правило под RLS источника. Для показа
 * и перехода в карточку дополнительный запрос к записи не нужен. Коммунальные сроки
 * (`sourceKind` не `record`) несут ещё объект, счёт или счётчик и основное действие.
 */
export const RadarItem = z.object({
  id: z.string(),
  deadlineId: z.string(),
  noteId: z.string().nullish(),
  objectId: z.string().nullish(),
  title: z.string().optional(),
  rule: DeadlineRule.optional(),
  /** Календарная дата начала в поясе дома: `YYYY-MM-DD`. */
  date: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  timeZone: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  assigneeId: z.string(),
  group: z.enum(RADAR_GROUPS),
  sourceKind: z.enum(SOURCE_KINDS).default('record'),
  object: z.object({ id: z.string(), title: z.string(), status: z.string().nullable() }).nullish(),
  utilityAccount: z
    .object({ id: z.string(), title: z.string(), number: z.string().nullish() })
    .nullish(),
  meter: z.object({ id: z.string(), title: z.string() }).nullish(),
  /** Окно показаний без активных счётчиков. */
  needsMeters: z.boolean().default(false),
  primaryAction: PrimaryAction.nullish(),
});
export type RadarItem = z.infer<typeof RadarItem>;
const Radar = z.object({
  items: z.array(RadarItem),
  groups: z.record(z.string(), z.number()),
  recalculating: z.boolean().default(false),
});

/** Все ещё не выполненные наступления до `to`; давно прошедшие разовые сроки тоже приходят. */
export function fetchRadar(from: string, to: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ from, to });
  return apiRequest('GET', `deadlines?${query}`, Radar, undefined, signal);
}

export function saveTimeZone(householdId: string, timeZone: string) {
  return apiRequest(
    'PATCH',
    `households/${householdId}/time-zone`,
    z.object({ householdId: z.string(), timeZone: z.string() }),
    { timeZone },
  );
}

const Marked = z.object({ id: z.string(), completedAt: z.string().nullable() });

/** Отметка оплаты; `completed: false` отменяет её. Повтор сохраняет первое время. */
export function completePayment(occurrenceId: string, completed: boolean) {
  return apiRequest('POST', `deadlines/occurrences/${occurrenceId}/complete-payment`, Marked, {
    completed,
  });
}

/** «Передано» для окна без счётчиков; `completed: false` отменяет отметку. */
export function completeReadings(occurrenceId: string, completed: boolean) {
  return apiRequest('POST', `deadlines/occurrences/${occurrenceId}/complete-readings`, Marked, {
    completed,
  });
}

export interface VerifyInput {
  verifiedOn: string;
  /** Без поля сервер пересчитает дату от интервала; `null` снимает её. */
  nextVerificationOn?: string | null;
}

/** «Поверка проведена»: возвращает карточку прибора с пересчитанной следующей датой. */
export function verifyMeter(meterId: string, input: VerifyInput) {
  return apiRequest('POST', `meters/${meterId}/verify`, MeterCard, input);
}

export function fetchMeterCard(meterId: string, signal?: AbortSignal) {
  return apiRequest('GET', `meters/${meterId}`, MeterCard, undefined, signal);
}
