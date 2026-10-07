import { FilesSection } from '../files/FilesSection.tsx';
import { useObjectContext } from './context.ts';
import { useRefreshObjects } from './queries.ts';

/** Вкладка «Файлы» (OBJ-4): фото и PDF объекта. Доступ к файлам такой же, как у объекта. */
export function ObjectFiles() {
  const { card, abilities } = useObjectContext();
  const refresh = useRefreshObjects();
  return (
    <FilesSection
      parent={{ kind: 'object', id: card.id }}
      card={card}
      canAdd={abilities.edit}
      refresh={refresh}
    />
  );
}
