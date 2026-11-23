import type { OperationReceipt } from '@homecrm/shared';
import { Dexie, type Table } from 'dexie';
import type { Me } from '../auth/api.ts';

export interface Identity {
  id: 'active';
  owner: string | null;
  generation: number;
  me: Me | null;
  verified: boolean;
  locked?: boolean;
}
export interface Snapshot {
  key: string;
  owner: string;
  path: string;
  capturedAt: number;
  bytes: number;
  data: unknown;
  versions: { id: string; version: string }[];
}
export type QueueState = 'pending' | 'sending' | 'unknown' | 'confirmed' | 'conflict' | 'error';
export interface Intent {
  id: string;
  owner: string;
  generation: number;
  house: string | null;
  entity: string;
  method: 'POST' | 'PATCH';
  path: string;
  operation: string;
  body: Record<string, unknown>;
  createdAt: number;
  state: QueueState;
  attempted: boolean;
  dependencies: string[];
  idFrom?: string;
  baseFrom?: string;
  photoFrom?: Record<string, string[]>;
  blobId?: string;
  frozenPath?: string;
  frozenBody?: string;
  receipt?: OperationReceipt;
  response?: unknown;
  /**
   * Время ответа сервера для окна отмены (D56): подтверждение мог получить другой отправитель —
   * SW или соседняя вкладка. `confirmedAt` — часы устройства в момент ответа.
   */
  confirmation?: { serverDate: string | null; elapsed: number; confirmedAt: number };
  code?: string;
  httpStatus?: number;
  nextAttempt: number;
  attempts: number;
  inputFingerprint?: string;
  formKey?: string;
  formValue?: unknown;
}
export interface StoredBlob {
  id: string;
  owner: string;
  blob: Blob;
  name: string;
}
export interface Draft {
  key: string;
  owner: string;
  data: unknown;
  updatedAt: number;
}
interface Lease {
  id: string;
  holder: string;
  expiresAt: number;
}
export function createOfflineDB(name = 'homecrm-offline') {
  const db = new Dexie(name) as Dexie & {
    identity: Table<Identity, string>;
    snapshots: Table<Snapshot, string>;
    outbox: Table<Intent, string>;
    blobs: Table<StoredBlob, string>;
    drafts: Table<Draft, string>;
    leases: Table<Lease, string>;
  };
  db.version(1).stores({
    identity: 'id',
    snapshots: 'key,owner,capturedAt',
    outbox: 'id,owner,entity,createdAt,state',
    blobs: 'id,owner',
    drafts: 'key,owner',
    leases: 'id',
  });
  // Индекс добавляется без удаления старых намерений, черновиков и исходных Blob.
  db.version(2).stores({ outbox: 'id,owner,entity,createdAt,state,nextAttempt' });
  return db;
}
export const offlineDB = createOfflineDB();
export const LIMITS = {
  snapshots: 80,
  snapshotAge: 7 * 86400000,
  snapshotBytes: 8 * 1024 * 1024,
  blobBytes: 60 * 1024 * 1024,
  intents: 300,
};
