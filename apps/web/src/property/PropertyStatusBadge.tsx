import { Status, type StatusTone } from '../ui/Row.tsx';
import { PROPERTY_STATUS_LABELS, type PropertyStatus } from './property.ts';

const TONES: Readonly<Record<PropertyStatus, StatusTone>> = {
  living: 'ok',
  rented: 'neutral',
  vacant: 'warning',
};

/** Статус недвижимости рядом с названием: текст и значок, цвет один его не передаёт (WCAG 1.4.1). */
export function PropertyStatusBadge({ status }: { status: PropertyStatus | undefined }) {
  if (status === undefined) return null;
  return <Status tone={TONES[status]}>{PROPERTY_STATUS_LABELS[status]}</Status>;
}
