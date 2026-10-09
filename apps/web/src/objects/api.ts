import { AUDIENCES, INTERACTION_KINDS, OBJECT_TYPES, PropertyData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import { FileMeta } from '../files/api.ts';
import { AccessPreview, type ListScope, type Placement } from '../notes/api.ts';
import { PersonLink } from '../organizations/api.ts';

// Объекты, связи и лента — ADR-0023, docs/objects-api.md. Ответы проверяются схемами: сервер мог
// измениться, а экран не должен ломаться на неожиданной форме. Названия, значения полей и тексты
// событий живут только в ответах и памяти страницы: в адреса, журнал и localStorage они не попадают.

export const MAX_TITLE = 200;
export const MAX_FIELDS = 50;
export const MAX_FIELD_NAME = 100;
export const MAX_FIELD_VALUE = 4000;
export const MAX_EVENT_TEXT = 10_000;
export const MAX_ROLE = 200;

const ObjectTypeSchema = z.enum(OBJECT_TYPES);

export const ObjectSummary = z.object({
  id: z.string(),
  title: z.string(),
  objectType: ObjectTypeSchema,
  /** Поля недвижимости (UTIL-1); у остальных типов — пустой объект. */
  typeData: PropertyData.catch({}),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type ObjectSummary = z.infer<typeof ObjectSummary>;

export const ObjectField = z.object({
  id: z.string(),
  name: z.string(),
  value: z.string(),
  position: z.number(),
  deletedAt: z.string().nullable(),
});
export type ObjectField = z.infer<typeof ObjectField>;

export const ObjectCard = ObjectSummary.extend({
  fields: z.array(ObjectField),
  /** Файлы объекта (OBJ-4): метаданные без ключей хранения. */
  files: z.array(FileMeta),
  /** «Люди и организации» (CONT-3): живые организации, связанные с объектом, и подписи ролей. */
  peopleAndOrganizations: z.array(PersonLink).default([]),
});
export type ObjectCard = z.infer<typeof ObjectCard>;

/** Своё поле при сохранении: у уже сохранённого есть `id`, у нового его нет. */
export interface FieldInput {
  id?: string;
  name: string;
  value: string;
}

export interface ObjectInput {
  title: string;
  objectType: z.infer<typeof ObjectTypeSchema>;
  fields: FieldInput[];
  /** Поля недвижимости; PATCH заменяет их целиком. */
  typeData?: PropertyData;
}

export type ObjectChange = Partial<ObjectInput> & {
  assigneeId?: string;
  expectedUpdatedAt?: string;
};

export const PAGE_SIZE = 100;

export function fetchObjects(
  scope: ListScope,
  options: { trash: boolean; offset: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    scope,
    trash: String(options.trash),
    limit: String(PAGE_SIZE),
    offset: String(options.offset),
  });
  return apiRequest('GET', `objects?${query}`, z.array(ObjectSummary), undefined, signal);
}

export function fetchObject(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `objects/${id}`, ObjectCard, undefined, signal);
}

/** Без `placement` объект создаётся личным — в пространстве автора. */
export function createObject(
  input: Pick<ObjectInput, 'title' | 'objectType'> &
    Partial<Pick<ObjectInput, 'fields' | 'typeData'>>,
  placement?: Placement,
) {
  return apiRequest('POST', 'objects', ObjectCard, {
    ...input,
    ...(placement ? { placement } : {}),
  });
}

export function patchObject(id: string, change: ObjectChange) {
  return apiRequest('PATCH', `objects/${id}`, ObjectCard, change);
}

export function previewObjectAccess(
  id: string,
  action: { action: 'personal' } | { action: 'audience'; audience: 'adults' | 'household' },
) {
  return apiRequest('POST', `objects/${id}/access-preview`, AccessPreview, action);
}

export function shareObject(id: string, spaceId: string, audience: 'adults' | 'household') {
  return apiRequest('POST', `objects/${id}/share`, ObjectCard, { spaceId, audience });
}

export function makeObjectPersonal(id: string) {
  return apiRequest('POST', `objects/${id}/personal`, ObjectCard, { confirmed: true });
}

export function changeObjectAudience(
  id: string,
  audience: 'adults' | 'household',
  confirmed: boolean,
) {
  return apiRequest('POST', `objects/${id}/audience`, ObjectCard, { audience, confirmed });
}

export function copyObjectToPersonal(id: string) {
  return apiRequest('POST', `objects/${id}/copy`, ObjectCard, {});
}

export function trashObject(id: string) {
  return apiRequest('POST', `objects/${id}/trash`, ObjectCard, {});
}

export function restoreObject(id: string) {
  return apiRequest('POST', `objects/${id}/restore`, ObjectCard, {});
}

// ---- Лента и ручные события (OBJ-3)

/**
 * Момент из ленты. Лента собирается в jsonb, и база отдаёт его как …+00:00 с микросекундами,
 * а xpectedUpdatedAt принимает только ISO с Z: приводим к тому же виду, что у карточек.
 */
const Instant = z.string().transform((value) => {
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) ? value : moment.toISOString();
});

export const RecordRef = z.object({ type: z.string(), id: z.string() });
export type RecordRef = z.infer<typeof RecordRef>;

const AutoItem = z.object({
  id: z.string(),
  at: z.string(),
  source: z.enum(['object', 'field']),
  operation: z.string(),
  actorId: z.string().nullable().optional(),
  changes: z.record(z.string(), z.unknown()).nullable().optional(),
  fieldId: z.string().optional(),
});

export const ManualEvent = z.object({
  id: z.string(),
  at: z.string(),
  source: z.literal('manual'),
  parentId: z.string(),
  /** Календарная дата `YYYY-MM-DD`: без часового пояса. */
  occurredOn: z.string(),
  text: z.string(),
  amountKopecks: z.number().nullable(),
  rating: z.number().nullable(),
  /** Невидимый контакт сервер отдаёт как `null`, как и отсутствующий. */
  contact: RecordRef.nullable(),
  authorId: z.string(),
  createdAt: Instant,
  updatedAt: Instant,
  deletedAt: z.string().nullable(),
});
export type ManualEvent = z.infer<typeof ManualEvent>;

/** Показание счётчика в ленте (OBJ-3, ADR-0032): значения и расход строками, без округления. */
export const ReadingEvent = z.object({
  id: z.string(),
  at: z.string(),
  source: z.literal('reading'),
  actorId: z.string().nullable().optional(),
  readingId: z.string(),
  meterId: z.string(),
  /** Календарная дата `YYYY-MM-DD`: без часового пояса. */
  occurredOn: z.string(),
  values: z.array(z.string()),
  consumption: z.array(z.string()).nullable(),
});
export type ReadingEvent = z.infer<typeof ReadingEvent>;

/** Взаимодействие контакта с этим объектом в ленте (CONT-4): видно, только если виден и контакт. */
export const InteractionEvent = z.object({
  id: z.string(),
  at: z.string(),
  source: z.literal('interaction'),
  interactionId: z.string(),
  contactId: z.string(),
  kind: z.enum(INTERACTION_KINDS),
  /** Календарная дата YYYY-MM-DD: без часового пояса. */
  occurredOn: z.string(),
  text: z.string(),
  amountCents: z.number().nullable(),
  callAgain: z.boolean().nullable(),
});
export type InteractionEvent = z.infer<typeof InteractionEvent>;

export const TimelineItem = z.union([ManualEvent, AutoItem, ReadingEvent, InteractionEvent]);
export type TimelineItem = z.infer<typeof TimelineItem>;
export type AutoEvent = z.infer<typeof AutoItem>;

export const TimelinePage = z.object({
  items: z.array(TimelineItem),
  nextCursor: z.string().nullable(),
});

export function fetchTimeline(id: string, cursor: string | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: '50' });
  if (cursor !== null) query.set('cursor', cursor);
  return apiRequest('GET', `objects/${id}/timeline?${query}`, TimelinePage, undefined, signal);
}

export interface EventInput {
  occurredOn: string;
  text: string;
  amountKopecks: number | null;
  rating: number | null;
}

export type EventChange = Partial<EventInput> & { expectedUpdatedAt?: string };

/** Ответ на запись события: тот же вид, что в ленте, но без `at` и `source`. */
const EventAnswer = ManualEvent.omit({ at: true, source: true });

export function createEvent(objectId: string, input: EventInput) {
  return apiRequest('POST', `objects/${objectId}/events`, EventAnswer, input);
}

export function patchEvent(objectId: string, eventId: string, change: EventChange) {
  return apiRequest('PATCH', `objects/${objectId}/events/${eventId}`, EventAnswer, change);
}

export function trashEvent(objectId: string, eventId: string) {
  return apiRequest('POST', `objects/${objectId}/events/${eventId}/trash`, EventAnswer, {});
}

export function restoreEvent(objectId: string, eventId: string) {
  return apiRequest('POST', `objects/${objectId}/events/${eventId}/restore`, EventAnswer, {});
}

// ---- Связи (OBJ-2)

export const RecordLink = z.object({
  id: z.string(),
  left: RecordRef,
  right: RecordRef,
  role: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type RecordLink = z.infer<typeof RecordLink>;

export function fetchLinks(ref: RecordRef, signal?: AbortSignal) {
  return apiRequest(
    'GET',
    `records/${ref.type}/${ref.id}/links?limit=100`,
    z.array(RecordLink),
    undefined,
    signal,
  );
}

export function createLink(left: RecordRef, right: RecordRef, role: string) {
  return apiRequest('POST', 'links', RecordLink, { left, right, role });
}

export function trashLink(id: string) {
  return apiRequest('POST', `links/${id}/trash`, RecordLink, {});
}

export function restoreLink(id: string) {
  return apiRequest('POST', `links/${id}/restore`, RecordLink, {});
}
