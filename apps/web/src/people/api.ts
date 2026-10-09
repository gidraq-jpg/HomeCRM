import { INTERACTION_KINDS, type PERSON_CATEGORIES, type PersonData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import type { ListScope, Placement } from '../notes/api.ts';
import { AnyContact, PersonCard } from './schema.ts';

// Люди и взаимодействия (CONT-1, CONT-3…5, ADR-0036, docs/passport-people-api.md). ФИО, телефоны,
// адреса, тексты и суммы живут только в ответах и памяти страницы.

export const MAX_TITLE = 200;
export const MAX_ITEMS = 20;
export const MAX_EMAIL = 254;
export const MAX_LABEL = 200;
export const MAX_TEXT = 4000;
export const MAX_NOTE = 10_000;
export const MAX_INTERACTION_TEXT = 10_000;
export const PAGE_SIZE = 100;

export type PersonCategory = (typeof PERSON_CATEGORIES)[number];
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export interface ContactFilters {
  kind: 'person' | 'organization' | null;
  category: PersonCategory | null;
  /** Поиск по ФИО и названию. Уходит в запрос, но не в адрес страницы. */
  query: string;
  scope: ListScope;
}

export function fetchContacts(
  filters: ContactFilters,
  options: { trash: boolean; offset: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    scope: filters.scope,
    trash: String(options.trash),
    limit: String(PAGE_SIZE),
    offset: String(options.offset),
  });
  if (filters.kind !== null) query.set('kind', filters.kind);
  if (filters.category !== null) query.set('category', filters.category);
  if (filters.query.trim() !== '') query.set('q', filters.query.trim());
  return apiRequest('GET', `contacts?${query}`, z.array(AnyContact), undefined, signal);
}

/** Люди для выбора: владелец документа, связь с объектом. Первая страница, по ФИО. */
export function fetchPeopleOptions(signal?: AbortSignal) {
  const query = new URLSearchParams({ kind: 'person', limit: String(PAGE_SIZE) });
  return apiRequest('GET', `contacts?${query}`, z.array(PersonCard), undefined, signal);
}

export function fetchContact(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `contacts/${id}`, AnyContact, undefined, signal);
}

export interface PersonInput {
  title: string;
  data: PersonData;
  organizationId: string | null;
}

export type PersonChange = Partial<PersonInput> & { expectedUpdatedAt?: string };

/** Без `placement` человек создаётся личным, а «мастер» — общим (PRD 7.2). */
export function createPerson(input: PersonInput, placement?: Placement) {
  return apiRequest('POST', 'contacts', PersonCard, {
    title: input.title,
    kind: 'person',
    data: input.data,
    ...(input.organizationId === null ? {} : { organizationId: input.organizationId }),
    ...(placement ? { placement } : {}),
  });
}

export function patchPerson(id: string, change: PersonChange) {
  return apiRequest('PATCH', `contacts/${id}`, PersonCard, change);
}

export function trashPerson(id: string) {
  return apiRequest('POST', `contacts/${id}/trash`, PersonCard, {});
}

export function restorePerson(id: string) {
  return apiRequest('POST', `contacts/${id}/restore`, PersonCard, {});
}

// ---- Взаимодействия (CONT-4)

export const Interaction = z.object({
  id: z.string(),
  parentId: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(['household', 'adults']).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  kind: z.enum(INTERACTION_KINDS),
  /** Календарная дата `YYYY-MM-DD`: без часового пояса. */
  occurredOn: z.string(),
  text: z.string(),
  amountCents: z.number().nullable(),
  callAgain: z.boolean().nullable(),
  /** Видимый объект; скрытый приходит как `null`. */
  objectId: z.string().nullable(),
  object: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type Interaction = z.infer<typeof Interaction>;

export interface InteractionInput {
  kind: InteractionKind;
  occurredOn: string;
  text: string;
  amountCents: number | null;
  callAgain: boolean | null;
  objectId: string | null;
}

export type InteractionChange = InteractionInput & { expectedUpdatedAt?: string };

export function fetchInteractions(contactId: string, offset: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  return apiRequest(
    'GET',
    `contacts/${contactId}/interactions?${query}`,
    z.array(Interaction),
    undefined,
    signal,
  );
}

export function createInteraction(contactId: string, input: InteractionInput) {
  return apiRequest('POST', `contacts/${contactId}/interactions`, Interaction, input);
}

export function patchInteraction(contactId: string, id: string, change: InteractionChange) {
  return apiRequest('PATCH', `contacts/${contactId}/interactions/${id}`, Interaction, change);
}

export function trashInteraction(contactId: string, id: string) {
  return apiRequest('POST', `contacts/${contactId}/interactions/${id}/trash`, Interaction, {});
}

export function restoreInteraction(contactId: string, id: string) {
  return apiRequest('POST', `contacts/${contactId}/interactions/${id}/restore`, Interaction, {});
}
