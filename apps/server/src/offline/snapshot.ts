import type { Transaction } from '@homecrm/db';
import { OfflineSnapshot } from '@homecrm/shared';
import { recordVersions } from '../idempotency.ts';

export const SNAPSHOT_TABLES: Record<string, string | null> = {
  '/api/tasks': 'tasks',
  '/api/tasks/:id': 'tasks',
  '/api/tasks/today': 'tasks',
  '/api/tasks/plan': 'tasks',
  '/api/notes': 'notes',
  '/api/notes/:id': 'notes',
  '/api/meters/:id': 'meters',
  '/api/objects/:id/meters': 'meters',
  '/api/objects/:id': 'objects',
  '/api/readings/:id': 'meter_readings',
  '/api/meters/:id/readings': 'meter_readings',
  '/api/objects': null,
  '/api/shopping': null,
  '/api/shopping/:id': null,
  '/api/documents': null,
  '/api/documents/:id': null,
  '/api/documents/:id/versions': null,
  '/api/contacts': null,
  '/api/contacts/:id': null,
  '/api/contacts/:id/interactions': null,
  '/api/accounts': null,
  '/api/accounts/:id': null,
  '/api/objects/:id/accounts': null,
};
/** Вызывается только в REPEATABLE READ той же транзакции, что прочла data. */
export async function offlineSnapshot(
  tx: Transaction,
  accountId: string,
  table: string | null,
  data: unknown,
) {
  if (!table) return OfflineSnapshot.parse({ accountId, data, versions: [] });
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.id === 'string' &&
      (row.spaceKind === 'personal' || row.spaceKind === 'household') &&
      /^[a-f0-9-]{36}$/i.test(row.id)
    )
      ids.add(row.id);
    for (const child of Object.values(row)) visit(child);
  };
  visit(data);
  const versions = await recordVersions(tx, table, [...ids]);
  return OfflineSnapshot.parse({ accountId, data, versions });
}
