import type { NotificationSettings } from '@homecrm/shared';
import { type DeadlineRule, deadlineOccurrences, localDate } from '@homecrm/shared';

type Kind = NotificationSettings['enabledKinds'][number];
/** Вид хранится вместе с предупреждением: начало и конец могут совпасть по времени. */
export function warningKinds(
  rule: DeadlineRule,
  row: {
    date: string;
    startsAt: Date;
    endsAt: Date;
    timeZone: string;
  },
  sourceKind: string,
): Map<string, Kind[]> {
  const result = new Map<string, Kind[]>();
  const add = (date: Date, kind: Kind) => {
    const key = date.toISOString();
    const kinds = result.get(key) ?? [];
    if (!kinds.includes(kind)) kinds.push(kind);
    result.set(key, kinds);
  };
  const calculate = (input: DeadlineRule) =>
    deadlineOccurrences(input, row.startsAt, row.timeZone, 0, true).find((x) => x.date === row.date)
      ?.warningsAt ?? [];
  for (const at of calculate({ ...rule, endWarnings: [] }))
    add(
      at,
      sourceKind === 'readings'
        ? 'readings_open'
        : sourceKind === 'payment'
          ? localDate(at, row.timeZone) === localDate(row.startsAt, row.timeZone)
            ? 'payment_due'
            : 'payment_upcoming'
          : sourceKind === 'verification'
            ? 'verification'
            : 'deadline',
    );
  for (const at of calculate({ ...rule, warnings: [] }))
    add(
      at,
      sourceKind === 'readings'
        ? localDate(at, row.timeZone) === localDate(row.endsAt, row.timeZone)
          ? 'readings_last_day'
          : 'readings_closing'
        : sourceKind === 'payment'
          ? 'payment_upcoming'
          : sourceKind === 'verification'
            ? 'verification'
            : 'deadline',
    );
  return result;
}
