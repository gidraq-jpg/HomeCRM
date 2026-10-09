import { AUDIENCES, type DOCUMENT_TYPES, DocumentData, type DocumentOwner } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import { FileMeta } from '../files/api.ts';
import type { ListScope, Placement } from '../notes/api.ts';

// Документы — ADR-0035, docs/month-documents-api.md. Ответы проверяются схемами: сервер мог
// измениться, а экран не должен ломаться на неожиданной форме. Названия, серии, номера и заметки
// живут только в ответах и памяти страницы: в адреса, журнал, localStorage и кэш они не попадают.

export const MAX_TITLE = 200;
export const MAX_SERIES = 100;
export const MAX_NUMBER = 200;
export const MAX_ISSUED_BY = 2000;
export const MAX_NOTE = 10_000;
export const MAX_TAG = 100;
export const MAX_TAGS = 30;
export const MAX_WARNINGS = 20;
export const PAGE_SIZE = 50;

export const DocumentStatus = z.enum(['valid', 'invalid']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const DocumentOwnerRef = z.object({
  kind: z.enum(['member', 'contact', 'object']),
  id: z.string(),
});

export const DocumentCard = z.object({
  id: z.string(),
  title: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  data: DocumentData,
  status: DocumentStatus,
  /** Предыдущая версия; скрытая от читателя приходит как `null`. */
  previousId: z.string().nullable(),
  /** Скрытый владелец-контакт приходит как `null`, как и отсутствующий. */
  owner: DocumentOwnerRef.nullable(),
});
export type DocumentCard = z.infer<typeof DocumentCard>;

export type DocumentExpiryFilter = 'expiring' | 'expired';
export type DocumentStatusFilter = 'valid' | 'all';

export interface DocumentFilters {
  scope: ListScope;
  /** Участник дома, чьи документы нужны; без него — все владельцы. */
  memberId: string | null;
  type: (typeof DOCUMENT_TYPES)[number] | null;
  expiry: DocumentExpiryFilter | null;
  status: DocumentStatusFilter;
  /** Поиск по названию и типу (DOC-7). Уходит в запрос, но не в адрес страницы. */
  query: string;
}

export const NO_FILTERS: DocumentFilters = {
  scope: 'all',
  memberId: null,
  type: null,
  expiry: null,
  status: 'valid',
  query: '',
};

export function fetchDocuments(
  filters: DocumentFilters,
  options: { trash: boolean; offset: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    scope: filters.scope,
    status: filters.status,
    trash: String(options.trash),
    limit: String(PAGE_SIZE),
    offset: String(options.offset),
  });
  if (filters.memberId !== null) {
    query.set('ownerKind', 'member');
    query.set('ownerId', filters.memberId);
  }
  if (filters.type !== null) query.set('type', filters.type);
  if (filters.expiry !== null) query.set('expiry', filters.expiry);
  if (filters.query.trim() !== '') query.set('q', filters.query.trim());
  return apiRequest('GET', `documents?${query}`, z.array(DocumentCard), undefined, signal);
}

/** Документы одного владельца-объекта для вкладки объекта. */
export function fetchObjectDocuments(objectId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({
    ownerKind: 'object',
    ownerId: objectId,
    status: 'valid',
    limit: '100',
  });
  return apiRequest('GET', `documents?${query}`, z.array(DocumentCard), undefined, signal);
}

export function fetchDocument(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `documents/${id}`, DocumentCard, undefined, signal);
}

export interface DocumentInput {
  title: string;
  data: DocumentData;
  owner: DocumentOwner | null;
  /** Без места документ создаётся личным — в пространстве автора. */
  placement?: Placement;
  assigneeId?: string;
}

export function createDocument(input: DocumentInput) {
  return apiRequest('POST', 'documents', DocumentCard, input);
}

export interface DocumentChange {
  title?: string;
  data?: DocumentData;
  expectedUpdatedAt?: string;
}

export function patchDocument(id: string, change: DocumentChange) {
  return apiRequest('PATCH', `documents/${id}`, DocumentCard, change);
}

/** «Продлить»: новая версия, прежняя становится недействительной (DOC-5). */
export function renewDocument(
  id: string,
  input: Required<Pick<DocumentChange, 'data'>> & DocumentChange,
) {
  return apiRequest('POST', `documents/${id}/renew`, DocumentCard, input);
}

export function fetchVersions(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `documents/${id}/versions`, z.array(DocumentCard), undefined, signal);
}

export function trashDocument(id: string) {
  return apiRequest('POST', `documents/${id}/trash`, DocumentCard, {});
}

export function restoreDocument(id: string) {
  return apiRequest('POST', `documents/${id}/restore`, DocumentCard, {});
}

/** «Поделиться со взрослыми»: перенос личного документа в общий дом с аудиторией «Взрослые». */
export function shareDocument(id: string, spaceId: string) {
  return apiRequest('POST', `documents/${id}/move`, DocumentCard, {
    spaceId,
    audience: 'adults',
    confirmed: true,
  });
}

export function changeAssignee(id: string, assigneeId: string) {
  return apiRequest('POST', `documents/${id}/assignee`, DocumentCard, { assigneeId });
}

/** Страницы документа (живые файлы): в карточке документа их нет, они приходят отдельным запросом. */
export function fetchDocumentFiles(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `documents/${id}/files`, z.array(FileMeta), undefined, signal);
}
