import { TZDate } from '@date-fns/tz';
import { NotificationSettings } from '@homecrm/shared';
import { addDays, format } from 'date-fns';

export const DEFAULT_SETTINGS = NotificationSettings.parse({});
/** Одинаковые часы выключают тихий интервал. Следующий конец строится календарно, включая DST. */
export function quietUntil(now: Date, zone: string, start: string, end: string): Date | null {
  if (start === end) return null;
  const local = new TZDate(now, zone),
    clock = format(local, 'HH:mm');
  const quiet = start < end ? clock >= start && clock < end : clock >= start || clock < end;
  if (!quiet) return null;
  const day = start > end && clock >= start ? addDays(local, 1) : local;
  const [hour = 0, minute = 0] = end.split(':').map(Number);
  return new Date(
    +new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, zone),
  );
}
export function budgetDate(now: Date, zone: string): string {
  return format(new TZDate(now, zone), 'yyyy-MM-dd');
}
export function retryAt(now: Date, attempts: number): Date {
  return new Date(+now + Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7)) * 1000);
}
