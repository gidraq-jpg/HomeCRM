import { AUDIENCES, type ORGANIZATION_TYPES, OrganizationData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import type { Placement } from '../notes/api.ts';

// Организации (CONT-2, ADR-0031, docs/property-accounts-api.md). Ответы проверяются схемами.
// Названия, телефоны и адреса живут только в ответах и памяти страницы: в адреса, журнал,
// localStorage и кэш сервис-воркера они не попадают.

export const MAX_TITLE = 200;
export const MAX_PHONES = 20;
export const MAX_NUMBER = 100;
export const MAX_LABEL = 200;
export const MAX_TEXT = 4000;
export const MAX_NOTE = 10_000;

export const ContactCard = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  data: OrganizationData,
});
export type ContactCard = z.infer<typeof ContactCard>;

/** Связь объекта с организацией из карточки объекта: подпись роли и сама организация. */
export const PersonLink = z.object({
  linkId: z.string(),
  role: z.string(),
  contact: ContactCard,
});
export type PersonLink = z.infer<typeof PersonLink>;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export interface OrganizationInput {
  title: string;
  data: OrganizationData;
}

export type OrganizationChange = Partial<OrganizationInput> & { expectedUpdatedAt?: string };

export const PAGE_SIZE = 100;

export function fetchOrganizations(
  options: { trash: boolean; offset: number; organizationType?: OrganizationType },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    trash: String(options.trash),
    limit: String(PAGE_SIZE),
    offset: String(options.offset),
  });
  if (options.organizationType) query.set('organizationType', options.organizationType);
  return apiRequest('GET', `contacts?${query}`, z.array(ContactCard), undefined, signal);
}

export function fetchOrganization(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `contacts/${id}`, ContactCard, undefined, signal);
}

/** Без `placement` организация создаётся общей «Вся семья» (PRD 7.2). */
export function createOrganization(input: OrganizationInput, placement?: Placement) {
  return apiRequest('POST', 'contacts', ContactCard, {
    ...input,
    kind: 'organization',
    ...(placement ? { placement } : {}),
  });
}

export function patchOrganization(id: string, change: OrganizationChange) {
  return apiRequest('PATCH', `contacts/${id}`, ContactCard, change);
}

export function trashOrganization(id: string) {
  return apiRequest('POST', `contacts/${id}/trash`, ContactCard, {});
}

export function restoreOrganization(id: string) {
  return apiRequest('POST', `contacts/${id}/restore`, ContactCard, {});
}
