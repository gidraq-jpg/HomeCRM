import { useMemo } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { useRadarItems } from './queries.ts';
import { buildRows, type RadarRow } from './radar.ts';

export interface RadarState {
  status: 'loading' | 'error' | 'ready';
  rows: RadarRow[];
  unresolved: number;
  recalculating: boolean;
  error: unknown;
  refetch: () => void;
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
  return {
    status: radar.data ? 'ready' : radar.isPending ? 'loading' : 'error',
    rows,
    unresolved: rows.filter((row) => row.to === null).length,
    recalculating: radar.data?.recalculating ?? false,
    error: radar.error,
    refetch: () => {
      void radar.refetch();
    },
  };
}
