import type { RadarFilterOption, RadarFilters } from '@homecrm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { startRadarPolling } from './polling.ts';
import { useRadarItems } from './queries.ts';
import { buildRows, type RadarRow } from './radar.ts';

export interface RadarState {
  visibleCount: number;
  matchingCount: number;
  options: {
    objects: Array<typeof RadarFilterOption._output>;
    people: Array<typeof RadarFilterOption._output>;
    houses: Array<typeof RadarFilterOption._output>;
  };
  status: 'loading' | 'error' | 'ready';
  rows: RadarRow[];
  unresolved: number;
  recalculating: boolean;
  /** Опрос исчерпал предел, а пересчёт всё ещё идёт: пора показать «Обновить». */
  stalled: boolean;
  error: unknown;
  refetch: () => void;
  /** «Обновить» после остановки опроса: перечитать радар и начать опрос заново. */
  retry: () => void;
}

/**
 * Один запрос несёт наступления и сведения источника под его RLS. poll: false — для второго
 * читателя того же запроса на экране: опрос во время пересчёта ведёт только один.
 */
export function useRadar({
  poll = true,
  filters = {},
}: {
  poll?: boolean;
  filters?: Partial<RadarFilters>;
} = {}): RadarState {
  const { me } = useHousehold();
  // Пояс /me — настройка сервера; наступления несут настоящий пояс своего дома.
  const radar = useRadarItems(me.id, 'UTC', filters);
  const rows = useMemo(() => {
    const now = new Date();
    return buildRows(radar.data?.items ?? [], {
      timeZone: radar.data?.items[0]?.timeZone ?? 'UTC',
      now,
      today: todayIn(radar.data?.items[0]?.timeZone ?? 'UTC', now),
      titleOf: () => undefined,
      locate: () => undefined,
    });
  }, [radar.data]);

  const recalculating = radar.data?.recalculating ?? false;
  const { refetch } = radar;
  const [stalled, setStalled] = useState(false);
  // Новый круг опроса после «Обновить»: эффект перезапускается, хотя `recalculating` не менялось.
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` только перезапускает опрос
  useEffect(() => {
    setStalled(false);
    if (!recalculating || !poll) return;
    return startRadarPolling({
      refetch: () => refetch(),
      onGiveUp: () => setStalled(true),
      isHidden: () => document.hidden,
      onVisible: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
    });
  }, [recalculating, refetch, round, poll]);

  const retry = useCallback(() => {
    setRound((value) => value + 1);
    void refetch();
  }, [refetch]);

  return {
    visibleCount: radar.data?.visibleCount ?? rows.length,
    matchingCount: radar.data?.matchingCount ?? rows.length,
    options: radar.data?.options ?? { objects: [], people: [], houses: [] },
    status: radar.data ? 'ready' : radar.isPending ? 'loading' : 'error',
    rows,
    unresolved: rows.filter((row) => row.to === null).length,
    recalculating,
    stalled: recalculating && stalled,
    error: radar.error,
    refetch: () => {
      void refetch();
    },
    retry,
  };
}
