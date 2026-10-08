import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMeters, fetchTransmission, type MeterStatus } from './api.ts';

// Ключи запросов не содержат названий, номеров и значений: только идентификаторы и режим списка.
const METERS = 'meters';
const TRANSMISSION = 'transmission';

/** Счётчики объекта: работающие по умолчанию, `all` — вместе с заменёнными и снятыми. */
export function useMeters(objectId: string, status: MeterStatus = 'active', enabled = true) {
  return useQuery({
    queryKey: [METERS, objectId, status],
    queryFn: ({ signal }) => fetchMeters(objectId, status, signal),
    enabled,
  });
}

/** Показания, которые ещё не переданы, по лицевым счетам объекта. */
export function useTransmission(objectId: string, enabled = true) {
  return useQuery({
    queryKey: [TRANSMISSION, objectId],
    queryFn: ({ signal }) => fetchTransmission(objectId, signal),
    enabled,
  });
}

/** Что перечитать после изменения счётчика или показания: списки, передачу, ленту и карточки. */
export function useRefreshMeters() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [METERS] }),
      client.invalidateQueries({ queryKey: [TRANSMISSION] }),
      client.invalidateQueries({ queryKey: ['objects'] }),
    ]);
}
