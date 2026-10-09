import { type DocumentOwner, type DocumentType, IDENTITY_DOCUMENT_TYPES } from '@homecrm/shared';
import type { Scope } from '../access/scope.ts';
import { defaultVisibility, type Visibility } from '../access/visibility.ts';

// «Кто видит» для нового документа — PRD 7.2: документ взрослого личный, документ ребёнка —
// «Взрослые», документ объекта — как у объекта. Решает сервер; здесь только подсказка по умолчанию
// и список значений, которые он не отклонит.

/** Что известно о владельце документа для выбора доступа. */
export interface OwnerFacts {
  kind: 'none' | 'member' | 'contact' | 'object';
  /** Владелец-участник — ребёнок. */
  childMember: boolean;
  /** Кто видит объект-владельца. */
  objectVisibility: Visibility | null;
}

export const NO_OWNER: OwnerFacts = { kind: 'none', childMember: false, objectVisibility: null };

/** Выбор владельца в списке: `member:<id>`, `contact:<id>`, `object:<id>`; пустая строка — не указан. */
export function ownerKey(owner: DocumentOwner | null): string {
  return owner === null ? '' : `${owner.kind}:${owner.id}`;
}

export function parseOwnerKey(key: string): DocumentOwner | null {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (id === '') return null;
  if (kind === 'member' || kind === 'contact' || kind === 'object') return { kind, id };
  return null;
}

/** Значения «Кто видит», которые сервер примет для этого владельца и типа. */
export function documentVisibilityOptions(
  creatable: readonly Visibility[],
  owner: OwnerFacts,
  type: DocumentType,
): Visibility[] {
  if (owner.kind === 'object' && owner.objectVisibility !== null) {
    return creatable.includes(owner.objectVisibility) ? [owner.objectVisibility] : [...creatable];
  }
  // Удостоверение ребёнка нельзя открыть всей семье (ADR-0035).
  if (owner.childMember && IDENTITY_DOCUMENT_TYPES.includes(type)) {
    return creatable.filter((value) => value !== 'household');
  }
  return [...creatable];
}

/** Значение по умолчанию: таблица 7.2 PRD и режим «Всё · Общее · Личное». */
export function defaultDocumentVisibility(
  scope: Scope,
  owner: OwnerFacts,
  options: readonly Visibility[],
): Visibility {
  let wanted: Visibility;
  if (owner.kind === 'object' && owner.objectVisibility !== null) wanted = owner.objectVisibility;
  else if (owner.childMember && scope !== 'personal') wanted = 'adults';
  else wanted = defaultVisibility('document', scope);
  return options.includes(wanted) ? wanted : (options[0] ?? 'personal');
}
