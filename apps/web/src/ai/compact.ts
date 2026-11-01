import { type DateOnly, formatShortDate } from '../ui/format.ts';
export function needsReview(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('confident' in value && value.confident === false) return true;
  return Object.values(value).some(needsReview);
}
export function selectedCount(rows: { selected: boolean }[]) {
  return rows.filter((row) => row.selected).length;
}
export function draftSummary(
  kind: string,
  fields: unknown,
  audience = 'Только я',
  assignee?: string,
): string {
  if (Array.isArray(fields)) return fields.map((f) => draftSummary(kind, f, audience)).join(' · ');
  const f = (fields ?? {}) as Record<string, { value?: unknown }>;
  const text = (key: string) => String(f[key]?.value ?? '');
  const values = Array.isArray(f.values)
    ? f.values.map((v: { value?: unknown }) => String(v.value ?? '—'))
    : Array.isArray(f.values?.value)
      ? f.values.value.map(String)
      : [];
  switch (kind) {
    case 'task':
      return [
        text('date') ? formatShortDate(text('date') as DateOnly) : 'Без срока',
        text('time'),
        assignee
          ? `Ответственный: ${assignee}`
          : text('assigneeId')
            ? 'Ответственный выбран'
            : 'Ответственный: я',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'shopping':
      return text('quantity') || 'Количество не указано';
    case 'note':
      return audience;
    case 'meter':
      return [
        text('meterId') ? 'Счётчик выбран' : 'Выберите счётчик',
        text('value') || values.join(' / '),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'object':
      return (
        (
          {
            property: 'Недвижимость',
            car: 'Автомобиль',
            appliance: 'Техника',
            other: 'Другое',
          } as Record<string, string>
        )[text('objectType')] ||
        text('type') ||
        'Объект'
      );
    default:
      return text('type') || text('period') || '';
  }
}
