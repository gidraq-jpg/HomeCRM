import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FileParent, fetchDeletedFiles, fetchTrashedFiles } from './api.ts';

// Ключи запросов содержат только идентификаторы: названий файлов в них нет.
const FILES = 'files';

/** Отдельно удалённые файлы живой записи. Для записи в корзине запрос не идёт. */
export function useDeletedFiles(parent: FileParent, enabled: boolean) {
  return useQuery({
    queryKey: [FILES, 'deleted', parent.kind, parent.id],
    queryFn: ({ signal }) => fetchDeletedFiles(parent, signal),
    enabled,
  });
}

/** Общая корзина файлов: удалённые файлы записей и снятые фото своего профиля. */
export function useTrashedFiles() {
  return useQuery({
    queryKey: [FILES, 'trash'],
    queryFn: ({ signal }) => fetchTrashedFiles(signal),
  });
}

/** Перечитать списки удалённых файлов после того, как файл убрали или вернули. */
export function useRefreshFiles() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [FILES] });
}
