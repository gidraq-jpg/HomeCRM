import { canRestore, type Viewer } from '@homecrm/shared';
import { factsOf, type PlacedRecord } from '../notes/abilities.ts';
import type { SourceKind } from './api.ts';

/**
 * Сможет ли участник вернуть срок из корзины. Сервер разрешает восстановление по автору срока
 * и месту записи (`canRestore`), поэтому и «Отменить» после «В корзину» показываем только тому,
 * кому восстановление не закончится отказом 403 (DEAD-1, PRD 6).
 */
export function mayRestoreDeadline(
  viewer: Viewer,
  source: SourceKind,
  deadline: PlacedRecord,
): boolean {
  const facts = factsOf(deadline, viewer, source === 'notes' ? 'note' : 'object');
  return canRestore(viewer, { ...facts, trashed: true });
}
