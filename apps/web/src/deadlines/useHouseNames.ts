import { useRadar } from './useRadar.ts';

/** Названия из существующего ответа радара: те же дома, которые доступны участнику. */
export function useHouseNames() {
  const radar = useRadar({ poll: false });
  return (id: string) => radar.options.houses.find((house) => house.id === id)?.title ?? 'Дом';
}
