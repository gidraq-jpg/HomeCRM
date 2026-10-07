import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { fetchSourceDeadlines, type RadarItem } from './api.ts';
import { usePendingTrash } from './pending.ts';
import { useRadarItems, useSourceTitles } from './queries.ts';
import { buildRows, type LocatedDeadline, type RadarRow } from './radar.ts';

export interface RadarState {
  status: 'loading' | 'error' | 'ready';
  /** Все пункты радара, которые видит участник, без фильтров показа. */
  rows: RadarRow[];
  /** Сколько пунктов не удалось сопоставить с записью: ссылка на карточку для них недоступна. */
  unresolved: number;
  error: unknown;
  refetch: () => void;
}

const KEY = 'deadlines';

/**
 * Радар для экранов: наступления с сервера, названия записей и подписи правил.
 * В наступлении запись не названа, поэтому связь «срок → запись» собирается по сохранённым
 * срокам записей, которые видит участник (см. отчёт задачи R0.8b: не хватает полей в API).
 */
export function useRadar(): RadarState {
  const { me } = useHousehold();
  const radar = useRadarItems(me.timeZone);
  const items = radar.data?.items;
  const titles = useSourceTitles(items !== undefined && items.length > 0);

  // Если сервер сам называет запись, читаем сроки только тех записей, что встретились в радаре.
  const known = items !== undefined && items.length > 0 && items.every(hasSource);
  const wanted = useMemo(() => {
    if (titles.data === undefined || items === undefined) return [];
    if (!known) return titles.data;
    const used = new Set(items.map((item) => item.noteId ?? item.objectId));
    return titles.data.filter((source) => used.has(source.id));
  }, [titles.data, items, known]);

  const located = useQueries({
    queries: wanted.map((source) => ({
      queryKey: [KEY, 'source', source.kind, source.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchSourceDeadlines(source.kind, source.id, signal),
    })),
    combine: (results) => ({
      pending: results.some((result) => result.isPending),
      failed: results.find((result) => result.isError)?.error ?? null,
      data: results.map((result) => result.data),
    }),
  });
  const pendingTrash = usePendingTrash();

  const index = useMemo(() => {
    const map = new Map<string, LocatedDeadline>();
    wanted.forEach((source, position) => {
      for (const deadline of located.data[position] ?? [])
        map.set(deadline.id, { kind: source.kind, sourceId: source.id, rule: deadline.rule });
    });
    return map;
  }, [wanted, located.data]);

  const titleIndex = useMemo(
    () =>
      new Map((titles.data ?? []).map((source) => [`${source.kind}:${source.id}`, source.title])),
    [titles.data],
  );

  const waiting =
    radar.isPending ||
    (items !== undefined && items.length > 0 && (titles.isPending || located.pending));
  const error = radar.error ?? titles.error ?? located.failed;

  const rows = useMemo(() => {
    if (waiting || items === undefined) return [];
    const now = new Date();
    return buildRows(
      items.filter((item) => !pendingTrash.has(item.deadlineId)),
      {
        timeZone: me.timeZone,
        now,
        today: todayIn(me.timeZone, now),
        titleOf: (kind, id) => titleIndex.get(`${kind}:${id}`),
        locate: (deadlineId) => index.get(deadlineId),
      },
    );
  }, [waiting, items, pendingTrash, me.timeZone, titleIndex, index]);

  return {
    status: error ? 'error' : waiting ? 'loading' : 'ready',
    rows,
    unresolved: rows.filter((row) => row.to === null).length,
    error,
    refetch: () => {
      void radar.refetch();
      void titles.refetch();
    },
  };
}

function hasSource(item: RadarItem): boolean {
  return Boolean(item.noteId ?? item.objectId);
}
