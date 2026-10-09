import type { Viewer } from '@homecrm/shared';
import { LinkSimple, Note } from '@phosphor-icons/react';
import { factsOf } from '../notes/abilities.ts';
import { useNoteCard } from '../notes/queries.ts';
import type { RecordRef } from '../objects/api.ts';
import { useObjectCard } from '../objects/queries.ts';
import { OBJECT_TYPE_ICONS } from '../objects/types.ts';

// Конец связи или ссылка на контакт: название, значок и права берутся из карточки записи, которую
// пользователь видит. Если вида записи в приложении ещё нет, показывается только подпись вида.

/** Куда ведёт связанная запись; для остальных видов записей экрана пока нет. */
export function routeOf(ref: RecordRef): string | null {
  if (ref.type === 'object') return `/home/${ref.id}`;
  if (ref.type === 'note') return `/more/notes/${ref.id}`;
  if (ref.type === 'contact') return `/people/contacts/${ref.id}`;
  return null;
}

export const OTHER_LABELS: Readonly<Record<string, string>> = {
  note_item: 'Пункт заметки',
  task: 'Дело',
  shopping_item: 'Покупка',
  object_field: 'Поле объекта',
  object_event: 'Событие объекта',
};

export function useEnd(ref: RecordRef, viewer: Viewer) {
  const object = useObjectCard(ref.type === 'object' ? ref.id : undefined);
  const note = useNoteCard(ref.type === 'note' ? ref.id : undefined);
  if (ref.type === 'object') {
    const card = object.data;
    return {
      loading: object.isPending,
      title: card?.title ?? null,
      facts: card ? factsOf(card, viewer, 'object') : null,
      icon: card ? OBJECT_TYPE_ICONS[card.objectType] : OBJECT_TYPE_ICONS.other,
    };
  }
  if (ref.type === 'note') {
    const card = note.data;
    return {
      loading: note.isPending,
      title: card?.title ?? null,
      facts: card ? factsOf(card, viewer, 'note') : null,
      icon: Note,
    };
  }
  return { loading: false, title: null, facts: null, icon: LinkSimple };
}
