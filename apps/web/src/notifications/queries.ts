import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDeliveries, fetchDevices, fetchSettings } from './api.ts';

// Ключи запросов без личных данных: только вид запроса.
const NOTIFICATIONS = 'notifications';

export function useDevices() {
  return useQuery({
    queryKey: [NOTIFICATIONS, 'devices'],
    queryFn: ({ signal }) => fetchDevices(signal),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: [NOTIFICATIONS, 'settings'],
    queryFn: ({ signal }) => fetchSettings(signal),
  });
}

export function useDeliveries() {
  return useQuery({
    queryKey: [NOTIFICATIONS, 'deliveries'],
    queryFn: ({ signal }) => fetchDeliveries(signal),
  });
}

/** Перечитать устройства, настройки и журнал после изменения. */
export function useRefreshNotifications() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [NOTIFICATIONS] });
}
