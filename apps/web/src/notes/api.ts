import { AUDIENCES, type Audience } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';
import { FileMeta } from '../files/api.ts';

// Заметки — ADR-0020 и apps/server/src/notes. Ответы проверяются схемами: сервер мог измениться,
// а экран не должен ломаться на неожиданной форме. Заголовки и тексты заметок живут только в
// ответах и памяти страницы: в адреса, журнал и localStorage они не попадают.

export const MAX_TITLE = 200;
export const MAX_BODY = 100_000;
export const MAX_ITEMS = 200;

const AudienceSchema = z.enum(AUDIENCES);

export const NoteSummary = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: AudienceSchema.nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type NoteSummary = z.infer<typeof NoteSummary>;

export const ChecklistItem = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  position: z.number(),
  deletedAt: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const NoteCard = NoteSummary.extend({
  body: z.string(),
  checklist: z.array(ChecklistItem),
  /** Файлы записи (OBJ-4): метаданные без ключей хранения. */
  files: z.array(FileMeta),
});
export type NoteCard = z.infer<typeof NoteCard>;

/** Пункт чек-листа при сохранении: у уже сохранённого есть `id`, у нового его нет. */
export interface ChecklistInput {
  id?: string;
  title: string;
  done: boolean;
}

export interface NoteInput {
  title: string;
  body: string;
  pinned: boolean;
  checklist: ChecklistInput[];
}

export interface Placement {
  spaceId: string;
  audience?: Audience;
}

export const AccessPreview = z.object({
  updatedAt: z.string(),
  losesAccess: z.array(z.object({ accountId: z.string(), displayName: z.string() })),
});
export type AccessPreview = z.infer<typeof AccessPreview>;

export type ListScope = 'all' | 'personal' | 'household';

export const PAGE_SIZE = 100;

export function fetchNotes(
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
  return apiRequest('GET', `notes?${query}`, z.array(NoteSummary), undefined, signal);
}

export function fetchNote(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `notes/${id}`, NoteCard, undefined, signal);
}

/** Без `placement` заметка создаётся личной — в пространстве автора. */
export function createNote(input: NoteInput, placement?: Placement) {
  return apiRequest('POST', 'notes', NoteCard, { ...input, ...(placement ? { placement } : {}) });
}

export type NoteChange = Partial<NoteInput> & { expectedUpdatedAt?: string };

export function patchNote(id: string, change: NoteChange) {
  return apiRequest('PATCH', `notes/${id}`, NoteCard, change);
}

export function previewAccess(id: string, action: { action: 'personal' } | AudiencePreview) {
  return apiRequest('POST', `notes/${id}/access-preview`, AccessPreview, action);
}
interface AudiencePreview {
  action: 'audience';
  audience: Audience;
}

export function shareNote(id: string, spaceId: string, audience: Audience) {
  return apiRequest('POST', `notes/${id}/share`, NoteCard, { spaceId, audience });
}

export function makePersonal(id: string) {
  return apiRequest('POST', `notes/${id}/personal`, NoteCard, { confirmed: true });
}

export function changeAudience(id: string, audience: Audience, confirmed: boolean) {
  return apiRequest('POST', `notes/${id}/audience`, NoteCard, { audience, confirmed });
}

export function copyToPersonal(id: string) {
  return apiRequest('POST', `notes/${id}/copy`, NoteCard, {});
}

export function trashNote(id: string) {
  return apiRequest('POST', `notes/${id}/trash`, NoteCard, {});
}

export function restoreNote(id: string) {
  return apiRequest('POST', `notes/${id}/restore`, NoteCard, {});
}
