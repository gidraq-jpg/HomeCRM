import type { RadarFilters } from '@homecrm/shared';
import { useRadar } from './useRadar.ts';

/** Названия из существующего ответа радара: те же дома, которые доступны участнику. */
export function useHouseNames(filters: Partial<RadarFilters> = {}) {
  const radar = useRadar({ poll: false, filters });
  return (id: string) => radar.options.houses.find((house) => house.id === id)?.title ?? 'Дом';
}
