import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIn } from '../objects/dates.ts';
import { addDays } from '../ui/format.ts';
import { fetchRadar, fetchSourceDeadlines, fetchTrashedDeadlines, type SourceKind } from './api.ts';

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

export function useRadarItems(accountId: string, timeZone: string) {
  const to = addDays(todayIn(timeZone), 91);
  return useQuery({
    queryKey: [DEADLINES, 'radar', accountId, timeZone, to],
    queryFn: ({ signal }) => fetchRadar(RADAR_FROM, to, signal),
    staleTime: 30_000,
    gcTime: 300_000,
    refetchInterval: (query) => (query.state.data?.recalculating ? 2_000 : false),
  });
}

export function useTrashedDeadlines() {
  return useQuery({
    queryKey: [DEADLINES, 'trash'],
    queryFn: ({ signal }) => fetchTrashedDeadlines(signal),
  });
}
