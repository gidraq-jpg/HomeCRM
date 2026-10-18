import { DOCUMENT_LABELS, type DocumentType } from '@homecrm/shared';

export interface RadarTaskSource {
  source_kind: string;
  label: string | null;
  title: string;
  date: string;
  period: string | null;
  document_type: DocumentType | null;
}

/** Название описывает действие; название записи остаётся запасным вариантом. */
export function radarTaskTitle(source: RadarTaskSource): string {
  const month = (date: string) =>
    new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(
      new Date(`${date.slice(0, 7)}-01T12:00:00Z`),
    );
  if (source.source_kind === 'payment') {
    const previous = new Date(`${source.date}T12:00:00Z`);
    previous.setUTCDate(1);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    return `Оплатить коммуналку за ${month(source.period ?? previous.toISOString())}`;
  }
  if (source.source_kind === 'readings') return `Передать показания за ${month(source.date)}`;
  if (source.source_kind === 'verification')
    return `Провести поверку: ${source.label ?? source.title}`;
  if (source.source_kind === 'document') {
    const type = source.document_type;
    if (type && ['osago', 'kasko', 'oms', 'dms'].includes(type))
      return `Продлить полис ${DOCUMENT_LABELS[type]}`;
    return `Продлить: ${source.label ?? source.title}`;
  }
  if (source.source_kind === 'birthday') return `Поздравить с днём рождения: ${source.title}`;
  return source.label ?? source.title;
}
