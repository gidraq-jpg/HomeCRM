import { AUDIENCES, DeadlineRule, RADAR_GROUPS } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

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

/**
 * Наступление срока для радара. Источник (запись) в ответе не назван: связь «срок → запись»
 * приходится собирать по карточкам (см. `sources.ts`); если сервер добавит `noteId` и `objectId`,
 * они используются сразу.
 */
export const RadarItem = z.object({
  id: z.string(),
  deadlineId: z.string(),
  noteId: z.string().nullish(),
  objectId: z.string().nullish(),
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
});
export type RadarItem = z.infer<typeof RadarItem>;

const Radar = z.object({
  items: z.array(RadarItem),
  groups: z.record(z.string(), z.number()),
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
