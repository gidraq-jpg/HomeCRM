import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotes, PAGE_SIZE as NOTES_PAGE } from '../notes/api.ts';
import { fetchObjects, PAGE_SIZE as OBJECTS_PAGE } from '../objects/api.ts';
import { todayIn } from '../objects/dates.ts';
import { addDays } from '../ui/format.ts';
import { fetchRadar, fetchSourceDeadlines, type SourceKind } from './api.ts';

// Ключи запросов не содержат названий и текстов: только идентификаторы, пояс и вид записи.
const DEADLINES = 'deadlines';

/** Сроки одной записи (карточка объекта или заметки). */
export function useSourceDeadlines(source: SourceKind, id: string) {
  return useQuery({
    queryKey: [DEADLINES, 'source', source, id],
    queryFn: ({ signal }) => fetchSourceDeadlines(source, id, signal),
  });
}

/** Что перечитать после изменения срока или часового пояса: карточки записей и радар. */
export function useRefreshDeadlines() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [DEADLINES] });
}

/** Радар охватывает 90 дней вперёд и всё, что просрочено, без ограничения давности. */
export const RADAR_FROM = '2000-01-01';

export function useRadarItems(timeZone: string) {
  const to = addDays(todayIn(timeZone), 91);
  return useQuery({
    queryKey: [DEADLINES, 'radar', timeZone, to],
    queryFn: ({ signal }) => fetchRadar(RADAR_FROM, to, signal),
  });
}

/** Сколько страниц списка записей читать, чтобы найти названия: до 500 заметок и 500 объектов. */
const MAX_PAGES = 5;

export interface SourceTitle {
  kind: SourceKind;
  id: string;
  title: string;
}

async function readPages<T>(size: number, read: (offset: number) => Promise<T[]>): Promise<T[]> {
  const result: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const chunk = await read(page * size);
    result.push(...chunk);
    if (chunk.length < size) break;
  }
  return result;
}

/**
 * Названия записей, которые видит участник. Сервер в наступлениях радара запись не называет,
 * поэтому названия берутся из списков заметок и объектов; видимость уже проверена сервером.
 */
export function useSourceTitles(enabled: boolean) {
  return useQuery({
    queryKey: [DEADLINES, 'titles'],
    enabled,
    queryFn: async (): Promise<SourceTitle[]> => {
      const [notes, objects] = await Promise.all([
        readPages(NOTES_PAGE, (offset) => fetchNotes('all', { trash: false, offset })),
        readPages(OBJECTS_PAGE, (offset) => fetchObjects('all', { trash: false, offset })),
      ]);
      return [
        ...notes.map((note) => ({ kind: 'notes' as const, id: note.id, title: note.title })),
        ...objects.map((object) => ({
          kind: 'objects' as const,
          id: object.id,
          title: object.title,
        })),
      ];
    },
  });
}
