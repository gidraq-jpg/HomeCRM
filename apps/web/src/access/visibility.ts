import { AUDIENCE_LABELS, type Audience } from '@homecrm/shared';
import type { Scope } from './scope.ts';

// Кто видит запись — PRD, разделы 7.1 и 7.4. Любая запись лежит либо в личном пространстве
// владельца, либо в общем пространстве дома с аудиторией «Взрослые» или «Вся семья».
// Названия аудиторий берутся из общего пакета, чтобы не разойтись с правилами доступа.

export type Visibility = 'personal' | Audience;

export const VISIBILITIES: readonly Visibility[] = ['personal', 'adults', 'household'];

/** Подписи значков: замок — «Только я», два человека — «Взрослые», дом — «Вся семья». */
export const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = {
  personal: 'Только я',
  adults: AUDIENCE_LABELS.adults,
  household: AUDIENCE_LABELS.household,
};

/** Что значит значение — для подписи в карточке и пояснения в форме. */
export const VISIBILITY_HINTS: Readonly<Record<Visibility, string>> = {
  personal: 'Видите только вы. Администратор и другие участники дома не увидят.',
  adults: 'Видят все взрослые дома. Детям запись не показывается.',
  household: 'Видят все в доме, включая детей.',
};

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value);
}

/** Вид записи, для которого выбирается значение по умолчанию. */
export type NewRecordKind = 'task' | 'note' | 'shopping' | 'document' | 'contact' | 'property';

export interface DefaultVisibilityContext {
  /**
   * Запись создаётся в карточке другой записи (например, объекта) с таким доступом.
   * Дела, заметки и документы объекта по умолчанию наследуют его доступ (таблица 7.2).
   */
  parent?: Visibility;
  /** Организации и мастера по умолчанию общие для всей семьи (таблица 7.2). */
  sharedByNature?: boolean;
}

/** Общая аудитория по умолчанию, когда включён режим «Общее». */
const SHARED_AUDIENCE: Readonly<Record<NewRecordKind, Audience>> = {
  property: 'adults',
  document: 'adults',
  task: 'household',
  note: 'household',
  shopping: 'household',
  contact: 'household',
};

/** Значение по умолчанию в режиме «Всё» — таблица 7.2 PRD. */
const DEFAULT_IN_ALL: Readonly<Record<NewRecordKind, Visibility>> = {
  property: 'adults',
  document: 'personal',
  task: 'personal',
  note: 'personal',
  shopping: 'household',
  contact: 'personal',
};

const INHERITS_PARENT: readonly NewRecordKind[] = ['task', 'note', 'document'];

/**
 * Значение строки «Кто видит» в форме создания. Раздел 7.4: в режиме «Личное» новые записи
 * личные, в режиме «Общее» — общие; в режиме «Всё» — по таблице 7.2.
 */
export function defaultVisibility(
  kind: NewRecordKind,
  scope: Scope,
  context: DefaultVisibilityContext = {},
): Visibility {
  if (scope === 'personal') return 'personal';

  const inherited = context.parent !== undefined && INHERITS_PARENT.includes(kind);
  if (scope === 'shared') {
    if (inherited && context.parent !== 'personal') return context.parent as Visibility;
    return SHARED_AUDIENCE[kind];
  }

  if (inherited) return context.parent as Visibility;
  if (kind === 'contact' && context.sharedByNature) return 'household';
  return DEFAULT_IN_ALL[kind];
}
