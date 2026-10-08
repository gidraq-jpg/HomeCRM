import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { startRadarPolling } from './polling.ts';
import { useRadarItems } from './queries.ts';
import { buildRows, type RadarRow } from './radar.ts';

export interface RadarState {
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

/** Один запрос несёт наступления и сведения источника под его RLS. */
export function useRadar(): RadarState {
  const { me } = useHousehold();
  const radar = useRadarItems(me.id, me.timeZone);
  const rows = useMemo(() => {
    const now = new Date();
    return buildRows(radar.data?.items ?? [], {
      timeZone: me.timeZone,
      now,
      today: todayIn(me.timeZone, now),
      titleOf: () => undefined,
      locate: () => undefined,
    });
  }, [radar.data, me.timeZone]);

  const recalculating = radar.data?.recalculating ?? false;
  const { refetch } = radar;
  const [stalled, setStalled] = useState(false);
  // Новый круг опроса после «Обновить»: эффект перезапускается, хотя `recalculating` не менялось.
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` только перезапускает опрос
  useEffect(() => {
    setStalled(false);
    if (!recalculating) return;
    return startRadarPolling({
      refetch: () => refetch(),
      onGiveUp: () => setStalled(true),
      isHidden: () => document.hidden,
      onVisible: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
    });
  }, [recalculating, refetch, round]);

  const retry = useCallback(() => {
    setRound((value) => value + 1);
    void refetch();
  }, [refetch]);

  return {
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
