import type { MeterListItem } from '../meters/api.ts';
import { countWord, type DateOnly, formatShortDate } from '../ui/format.ts';
import type { RadarRow, UtilityRow } from './radar.ts';

// Коммунальные сроки в радаре и на «Сегодня» (UTIL-7, UTIL-13): чистые функции без React.
// Названия объектов и номера счетов живут только в памяти страницы и ответах API.

/** «до 25 окт.»: конец окна показаний в часовом поясе дома. */
export function untilText(endDate: DateOnly, today: DateOnly): string {
  return `до ${formatShortDate(endDate, today)}`;
}

/** «2 счётчика без показаний» (PRD, раздел 13). */
export function metersWithoutText(count: number): string {
  return `${countWord(count, ['счётчик', 'счётчика', 'счётчиков'])} без показаний`;
}

export interface WindowProgress {
  /** Активных счётчиков счёта. */
  total: number;
  /** Без показания, датированного внутри окна. */
  missing: number;
  /** Показание внесено, но ещё не передано поставщику. */
  untransmitted: number;
}

/** Как идёт окно: сколько счётчиков счёта ещё без показаний. Закрывает окно только переданное показание. */
export function windowProgress(
  meters: readonly MeterListItem[],
  row: Pick<UtilityRow, 'accountId' | 'startDate' | 'endDate'>,
): WindowProgress {
  const own = meters.filter(
    (meter) => meter.data.status === 'active' && meter.utilityAccountId === row.accountId,
  );
  let missing = 0;
  let untransmitted = 0;
  for (const meter of own) {
    const reading = meter.previousReading;
    if (reading === null || reading.occurredOn < row.startDate || reading.occurredOn > row.endDate)
      missing += 1;
    else if (reading.transmissionStatus !== 'transmitted') untransmitted += 1;
  }
  return { total: own.length, missing, untransmitted };
}

/** Строка о ходе окна: «2 счётчика без показаний» или «Показания внесены, осталось передать». */
export function progressText(progress: WindowProgress): string | null {
  if (progress.missing > 0) return metersWithoutText(progress.missing);
  if (progress.untransmitted > 0) return 'Показания внесены, осталось передать';
  return null;
}

/** Открытое окно показаний: строка радара, которую надо показать карточкой на «Сегодня». */
export function isOpenWindow(row: RadarRow): row is RadarRow & { utility: UtilityRow } {
  return row.utility?.kind === 'readings' && row.group === 'now';
}

export interface WindowCard {
  objectId: string;
  title: string;
  status: UtilityRow['status'];
  visibility: RadarRow['visibility'];
  /** Окна объекта: у разных лицевых счетов окна могут различаться. */
  windows: (RadarRow & { utility: UtilityRow })[];
}

/** Открытые окна по объектам: на объект — одна карточка; объекты по названию. */
export function windowCards(rows: readonly RadarRow[]): WindowCard[] {
  const cards = new Map<string, WindowCard>();
  for (const row of rows) {
    if (!isOpenWindow(row)) continue;
    const found = cards.get(row.utility.objectId);
    if (found) {
      found.windows.push(row);
      continue;
    }
    cards.set(row.utility.objectId, {
      objectId: row.utility.objectId,
      title: row.title ?? 'Объект',
      status: row.utility.status,
      visibility: row.visibility,
      windows: [row],
    });
  }
  return [...cards.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

/** Идентификаторы объектов с открытым окном: «Другой объект» показывает их первыми. */
export function openWindowObjectIds(rows: readonly RadarRow[]): Set<string> {
  return new Set(rows.filter(isOpenWindow).map((row) => row.utility.objectId));
}
