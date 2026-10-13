import {
  OfflineNoteCreate,
  OfflineNotePatch,
  OfflineReadingCreate,
  OfflineReadingsCreate,
  OfflineTaskCreate,
  OfflineTaskPatch,
  OfflineTaskStatus,
  OperationReceipt,
} from '@homecrm/shared';
import type { z } from 'zod';
import { Me } from '../auth/api.ts';
import {
  assertIdentity,
  blockIdentity,
  changed,
  LocalFailure,
  LocalSaved,
  requestTicket,
  setIdentity,
  ticket,
} from './identity.ts';
import { exactVersion } from './snapshots.ts';
import { type Identity, type Intent, LIMITS, offlineDB, type StoredBlob, uuid } from './store.ts';

const definitions: { method: string; route: RegExp; operation: string; schema: z.ZodType }[] = [
  { method: 'POST', route: /^tasks$/, operation: 'task_create', schema: OfflineTaskCreate },
  {
    method: 'PATCH',
    route: /^tasks\/(?:[0-9a-f-]{36}|local:[0-9a-f-]{36})$/,
    operation: 'task_patch',
    schema: OfflineTaskPatch,
  },
  {
    method: 'POST',
    route: /^tasks\/(?:[0-9a-f-]{36}|local:[0-9a-f-]{36})\/status$/,
    operation: 'task_status',
    schema: OfflineTaskStatus,
  },
  { method: 'POST', route: /^notes$/, operation: 'note_create', schema: OfflineNoteCreate },
  {
    method: 'PATCH',
    route: /^notes\/(?:[0-9a-f-]{36}|local:[0-9a-f-]{36})$/,
    operation: 'note_patch',
    schema: OfflineNotePatch,
  },
  {
    method: 'POST',
    route: /^meters\/[0-9a-f-]{36}\/readings$/,
    operation: 'reading_create',
    schema: OfflineReadingCreate,
  },
  {
    method: 'POST',
    route: /^objects\/[0-9a-f-]{36}\/readings$/,
    operation: 'readings_create',
    schema: OfflineReadingsCreate,
  },
];
export function definition(method: string, path: string) {
  return definitions.find((def) => def.method === method && def.route.test(path));
}
function storageError(error: unknown): never {
  if (error instanceof LocalFailure) throw error;
  throw new LocalFailure(
    error instanceof Error && /Quota/.test(error.name) ? 'LOCAL_QUOTA' : 'LOCAL_STORAGE',
  );
}
export async function persistIntents(intents: Intent[], blobs: StoredBlob[] = []) {
  try {
    await offlineDB.transaction(
      'rw',
      offlineDB.identity,
      offlineDB.outbox,
      offlineDB.blobs,
      offlineDB.drafts,
      async () => {
        const first = intents[0];
        if (!first) return;
        await assertIdentity({ owner: first.owner, generation: first.generation });
        const count = await offlineDB.outbox
          .where('owner')
          .equals(first.owner)
          .filter((row) => row.state !== 'confirmed')
          .count();
        if (count + intents.length > LIMITS.intents) throw new LocalFailure('LOCAL_QUOTA');
        const old = await offlineDB.blobs.where('owner').equals(first.owner).toArray();
        if ([...old, ...blobs].reduce((sum, row) => sum + row.blob.size, 0) > LIMITS.blobBytes)
          throw new LocalFailure('LOCAL_QUOTA');
        await offlineDB.blobs.bulkAdd(blobs);
        for (const row of intents) {
          await offlineDB.outbox.add(row);
          await offlineDB.drafts.put({
            key: row.id,
            owner: row.owner,
            data: row.body,
            updatedAt: Date.now(),
          });
        }
      },
    );
  } catch (error) {
    storageError(error);
  }
  changed();
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.ready
      .then((registration) => {
        const sync = (
          registration as ServiceWorkerRegistration & {
            sync?: { register: (tag: string) => Promise<void> };
          }
        ).sync;
        return sync?.register('homecrm-outbox');
      })
      .catch(() => {
        /* Повтор при открытии остаётся доступен в неподдерживающем браузере. */
      });
  }
}
function newIntent(
  expected: Identity,
  method: 'POST' | 'PATCH',
  path: string,
  operation: string,
  body: Record<string, unknown>,
  entity: string,
): Intent {
  return {
    id: String(body.idempotencyKey ?? uuid()),
    owner: expected.owner ?? '',
    generation: expected.generation,
    house:
      (body.householdId as string | undefined) ??
      (body.placement as { spaceId?: string } | undefined)?.spaceId ??
      null,
    entity,
    method,
    path,
    operation,
    body,
    createdAt: Date.now(),
    state: 'pending',
    attempted: false,
    dependencies: [],
    nextAttempt: 0,
    attempts: 0,
  };
}
export interface IntentForm {
  key: string;
  value: unknown;
}
export async function enqueue(
  method: 'POST' | 'PATCH',
  path: string,
  source: Record<string, unknown>,
  options: { idFrom?: string; baseFrom?: string; form?: IntentForm } = {},
) {
  const expected = await requestTicket();
  await assertIdentity(expected);
  const def = definition(method, path);
  if (!def) throw new LocalFailure('NETWORK_REQUIRED');
  const fingerprint = JSON.stringify(source);
  if (!source.idempotencyKey) {
    const same = await offlineDB.outbox
      .where('owner')
      .equals(expected.owner ?? '')
      .filter(
        (row) =>
          row.path === path && row.inputFingerprint === fingerprint && row.state !== 'confirmed',
      )
      .first();
    if (same) return same;
  }
  const key = typeof source.idempotencyKey === 'string' ? source.idempotencyKey : uuid();
  const existing = await offlineDB.outbox.get(key);
  if (existing) {
    if (existing.owner !== expected.owner) throw new LocalFailure('ACCOUNT_CHANGED');
    if (existing.path !== path || existing.inputFingerprint !== fingerprint)
      throw new LocalFailure('ALREADY_SENT');
    return existing;
  }
  const body = {
    ...source,
    offline: true,
    ownerAccountId: expected.owner,
    idempotencyKey: key,
    clientActedAt: new Date().toISOString(),
  } as Record<string, unknown>;
  // Назначение себе при создании не меняет серверную семантику по умолчанию.
  if (def.operation === 'task_create' && body.assigneeId === expected.owner) delete body.assigneeId;
  if (body.repeatScope === 'this') delete body.repeatScope;
  if (def.operation.startsWith('note') && Array.isArray(body.checklist))
    body.checklist = body.checklist.map((raw) => {
      const item = raw as Record<string, unknown>;
      return item.id || item.clientId ? item : { ...item, clientId: uuid() };
    });
  const needsVersion = ['task_patch', 'task_status', 'note_patch'].includes(def.operation);
  // Сначала allowlist: обычная сетевая правка серии не требует локального снимка.
  if (
    !def.schema.safeParse({
      ...body,
      ...(needsVersion ? { expectedUpdatedAt: '2000-01-01T00:00:00.000000Z' } : {}),
    }).success
  )
    throw new LocalFailure('NETWORK_REQUIRED');
  const id = path.split('/')[1];
  const entity = options.idFrom ? `local:${options.idFrom}` : (id ?? `local:${key}`);
  const previous = (
    await offlineDB.outbox
      .where('owner')
      .equals(expected.owner ?? '')
      .toArray()
  )
    .filter(
      (row) =>
        row.entity === entity &&
        row.state !== 'confirmed' &&
        // Неуспешный запрос не база новой правки явно показанного серверного snapshot.
        !(
          typeof source.expectedUpdatedAt === 'string' && ['conflict', 'error'].includes(row.state)
        ),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const baseFrom = previous?.id ?? options.baseFrom;
  if (needsVersion) {
    body.expectedUpdatedAt = baseFrom
      ? '2000-01-01T00:00:00.000000Z'
      : await exactVersion(
          id ?? '',
          expected,
          typeof source.expectedUpdatedAt === 'string' ? source.expectedUpdatedAt : undefined,
        );
  }
  const parsed = def.schema.safeParse(body);
  if (!parsed.success) throw new LocalFailure('NETWORK_REQUIRED');
  const intent = newIntent(
    expected,
    method,
    path,
    def.operation,
    parsed.data as Record<string, unknown>,
    entity,
  );
  intent.inputFingerprint = fingerprint;
  if (options.form) {
    intent.formKey = options.form.key;
    intent.formValue = options.form.value;
  }
  if (options.idFrom) intent.idFrom = options.idFrom;
  if (baseFrom) intent.baseFrom = baseFrom;
  intent.dependencies = [
    ...new Set([previous?.id, options.idFrom, baseFrom].filter((v): v is string => !!v)),
  ];
  await persistIntents([intent]);
  return intent;
}
export async function durableMutation(
  method: string,
  path: string,
  body: unknown,
  form?: IntentForm,
): Promise<unknown | undefined> {
  if (!definition(method, path) || !body || typeof body !== 'object') {
    if (!navigator.onLine) throw new LocalFailure('NETWORK_REQUIRED');
    return undefined;
  }
  let intent: Intent;
  try {
    intent = await enqueue(method as 'POST' | 'PATCH', path, body as Record<string, unknown>, {
      form,
    });
  } catch (error) {
    // Не в allowlist (назначение, серия, доступ): сетевой контракт сохраняется.
    if (navigator.onLine && error instanceof LocalFailure && error.code === 'NETWORK_REQUIRED')
      return undefined;
    throw error;
  }
  if (navigator.onLine) {
    // Повтор из формы снимает backoff, но сохраняет замороженные тело и ключ.
    if (intent.state === 'unknown') await retryIntent(intent.id);
    else await synchronize();
  }
  const current = await offlineDB.outbox.get(intent.id);
  if (current?.state === 'confirmed') {
    const info = lastTiming.get(intent.id);
    if (info && current.response && typeof current.response === 'object')
      timing.set(current.response, info);
    return current.response;
  }
  if (current?.state === 'error' && current.httpStatus === undefined)
    throw new LocalFailure(current.code ?? 'LOCAL_CONFIRMATION');
  if (current?.state === 'conflict' || current?.state === 'error')
    throw Object.assign(new Error('QUEUE_ERROR'), {
      status: current.httpStatus ?? 409,
      code: current.code ?? '',
    });
  if (navigator.onLine && path === 'tasks' && current?.state === 'unknown')
    throw Object.assign(new Error('QUEUE_OUTCOME_UNKNOWN'), {
      status: 0,
      code: 'OUTCOME_UNKNOWN',
      intentId: intent.id,
    });
  throw new LocalSaved(intent.id);
}
export interface ReadingQueueInput {
  objectId: string;
  objectUpdatedAt: string;
  spaceId: string;
  spaceKind: 'household' | 'personal';
  readings: (Record<string, unknown> & {
    meterId: string;
    expectedUpdatedAt: string;
    expectedLatestReadingId: string | null;
  })[];
  files: Record<string, File[]>;
  single?: boolean;
}
export async function enqueueReadings(input: ReadingQueueInput) {
  const source = {
    ...input,
    files: await Promise.all(
      Object.entries(input.files).map(async ([meter, files]) => [
        meter,
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            hash: [
              ...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
            ]
              .map((value) => value.toString(16).padStart(2, '0'))
              .join(''),
          })),
        ),
      ]),
    ),
  };
  const fingerprint = JSON.stringify(source);

  const expected = await requestTicket();
  await assertIdentity(expected);
  const same = await offlineDB.outbox
    .where('owner')
    .equals(expected.owner ?? '')
    .filter((row) => row.inputFingerprint === fingerprint && row.state !== 'confirmed')
    .first();
  if (same) return same;
  const intents: Intent[] = [];
  const blobs: StoredBlob[] = [];
  const photoFrom: Record<string, string[]> = {};
  let previousPhoto: string | undefined;
  const hasPhotos = Object.values(input.files).some((values) => values.length);
  const objectVersion = hasPhotos
    ? await exactVersion(input.objectId, expected, input.objectUpdatedAt)
    : '';
  for (const reading of input.readings) {
    photoFrom[reading.meterId] = [];
    for (const file of input.files[reading.meterId] ?? []) {
      if (file.size > 20 * 1024 * 1024 || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type))
        throw new LocalFailure('NETWORK_REQUIRED');
      const id = uuid();
      const blobId = uuid();
      const row = newIntent(
        expected,
        'POST',
        `objects/${input.objectId}/files`,
        'file_upload',
        { idempotencyKey: id, expectedUpdatedAt: objectVersion },
        input.objectId,
      );
      row.blobId = blobId;
      row.baseFrom = previousPhoto;
      row.dependencies = previousPhoto ? [previousPhoto] : [];
      row.house = input.spaceKind === 'household' ? input.spaceId : null;
      intents.push(row);
      blobs.push({ id: blobId, owner: row.owner, blob: file, name: file.name });
      photoFrom[reading.meterId]?.push(id);
      previousPhoto = id;
    }
  }
  const readings = [];
  for (const source of input.readings) {
    const version = await exactVersion(source.meterId, expected, source.expectedUpdatedAt);
    readings.push({ ...source, expectedUpdatedAt: version });
  }
  const key = uuid();
  const metadata = {
    offline: true,
    ownerAccountId: expected.owner,
    idempotencyKey: key,
    clientActedAt: new Date().toISOString(),
  };
  const first = readings[0];
  if (!first) throw new LocalFailure('NETWORK_REQUIRED');
  const { meterId, ...singleBody } = first;
  const body = input.single ? { ...singleBody, ...metadata } : { readings, ...metadata };
  const schema = input.single ? OfflineReadingCreate : OfflineReadingsCreate;
  const parsed = schema.parse(body);
  const row = newIntent(
    expected,
    'POST',
    input.single ? `meters/${meterId}/readings` : `objects/${input.objectId}/readings`,
    input.single ? 'reading_create' : 'readings_create',
    parsed as Record<string, unknown>,
    input.objectId,
  );
  row.inputFingerprint = fingerprint;
  row.photoFrom = photoFrom;
  row.dependencies = intents.map((intent) => intent.id);
  row.house = input.spaceKind === 'household' ? input.spaceId : null;
  intents.push(row);
  const createdAt = Date.now();
  intents.forEach((value, index) => {
    value.createdAt = createdAt + index;
  });
  await persistIntents(intents, blobs);
  return row;
}
export async function cancelIntent(id: string) {
  const active = await ticket();
  await offlineDB.transaction(
    'rw',
    offlineDB.identity,
    offlineDB.outbox,
    offlineDB.blobs,
    offlineDB.drafts,
    async () => {
      await assertIdentity(active);
      const row = await offlineDB.outbox.get(id);
      if (!row || row.owner !== active.owner) throw new LocalFailure('ACCOUNT_CHANGED');
      if (row.attempted && !['conflict', 'error'].includes(row.state))
        throw new LocalFailure('ALREADY_SENT');
      if (
        (await offlineDB.outbox.where('owner').equals(row.owner).toArray()).some((next) =>
          next.dependencies.includes(id),
        )
      )
        throw new LocalFailure('DEPENDENT');
      await offlineDB.outbox.delete(id);
      await offlineDB.drafts.delete(id);
      if (row.blobId) await offlineDB.blobs.delete(row.blobId);
    },
  );
  changed();
}
export async function retryIntent(id: string) {
  const active = await ticket();
  await assertIdentity(active);
  const row = await offlineDB.outbox.get(id);
  if (!row || row.owner !== active.owner) throw new LocalFailure('ACCOUNT_CHANGED');
  // Повтор всегда сохраняет уже отправленный payload и ключ.
  await offlineDB.outbox.update(id, {
    state: row.attempted ? 'unknown' : 'pending',
    nextAttempt: 0,
    code: undefined,
  });
  changed();
  await synchronize();
}
export async function resolveConflict(
  id: string,
  change: Record<string, unknown>,
  expectedUpdatedAt: string,
) {
  const active = await ticket();
  await assertIdentity(active);
  const row = await offlineDB.outbox.get(id);
  if (!row || row.owner !== active.owner || row.state !== 'conflict')
    throw new LocalFailure('ACCOUNT_CHANGED');
  // Отдельное осознанное намерение после свежего согласованного чтения.
  const body: Record<string, unknown> = { ...row.body, ...change, expectedUpdatedAt };
  delete body.idempotencyKey;
  delete body.clientActedAt;
  delete body.offline;
  delete body.ownerAccountId;
  body.expectedUpdatedAt = await exactVersion(
    (row.frozenPath ?? row.path).split('/')[1] ?? '',
    active,
    expectedUpdatedAt,
  );
  const key = uuid();
  body.idempotencyKey = key;
  body.offline = true;
  body.ownerAccountId = active.owner;
  body.clientActedAt = new Date().toISOString();
  const resolvedPath = row.frozenPath ?? row.path;
  const def = definition(row.method, resolvedPath);
  if (!def) throw new LocalFailure('NETWORK_REQUIRED');
  const parsed = def.schema.parse(body) as Record<string, unknown>;
  const replacement = newIntent(
    active,
    row.method,
    resolvedPath,
    row.operation,
    parsed,
    row.entity,
  );
  await offlineDB.transaction(
    'rw',
    offlineDB.identity,
    offlineDB.outbox,
    offlineDB.drafts,
    async () => {
      await assertIdentity(active);
      const descendants = await offlineDB.outbox.where('owner').equals(row.owner).toArray();
      if (descendants.some((dep) => dep.dependencies.includes(id) && dep.attempted))
        throw new LocalFailure('ALREADY_SENT');
      await offlineDB.outbox.add(replacement);
      await offlineDB.drafts.put({ key, owner: row.owner, data: parsed, updatedAt: Date.now() });
      for (const dep of descendants) {
        if (!dep.dependencies.includes(id)) continue;
        await offlineDB.outbox.update(dep.id, {
          dependencies: dep.dependencies.map((ref) => (ref === id ? key : ref)),
          baseFrom: dep.baseFrom === id ? key : dep.baseFrom,
          idFrom: dep.idFrom === id ? key : dep.idFrom,
        });
      }
      await offlineDB.outbox.delete(id);
      await offlineDB.drafts.delete(id);
    },
  );
  changed();
  return replacement;
}
async function freshMe(expected: Identity) {
  const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) await blockIdentity();
    return null;
  }
  const parsed = Me.safeParse(await response.json());
  if (!parsed.success || parsed.data.secondFactorRequired) return null;
  // Окно и SW одинаково применяют авторитетный доступ; прежний snapshot отзывается до replay.
  await setIdentity(parsed.data, expected);
  return ticket();
}
const lastTiming = new Map<
  string,
  { serverDate: string | null; elapsed: number; receivedAt: number }
>();
const timing = new WeakMap<
  object,
  { serverDate: string | null; elapsed: number; receivedAt: number }
>();
export function durableTiming(value: unknown) {
  return value && typeof value === 'object' ? timing.get(value) : undefined;
}
const LEASE_MS = 45000;
export async function synchronize(): Promise<void> {
  let active = await ticket();
  if (!active.owner) return;
  let me: Awaited<ReturnType<typeof freshMe>>;
  try {
    me = await freshMe(active);
  } catch {
    return;
  }
  if (!me || me.owner !== active.owner) return;
  active = me;
  await assertIdentity(active);
  const holder = uuid();
  const acquired = await offlineDB.transaction(
    'rw',
    offlineDB.identity,
    offlineDB.leases,
    async () => {
      await assertIdentity(active);
      const lease = await offlineDB.leases.get('sender');
      if (lease && lease.expiresAt > Date.now()) return false;
      await offlineDB.leases.put({ id: 'sender', holder, expiresAt: Date.now() + LEASE_MS });
      return true;
    },
  );
  if (!acquired) return;
  try {
    const list = await offlineDB.outbox
      .where('owner')
      .equals(active.owner ?? '')
      .sortBy('createdAt');
    for (const original of list) {
      await assertIdentity(active);
      const lease = await offlineDB.leases.get('sender');
      if (lease?.holder !== holder) return;
      await offlineDB.leases.update('sender', { expiresAt: Date.now() + LEASE_MS });
      const row = await offlineDB.outbox.get(original.id);
      if (
        !row ||
        row.state === 'confirmed' ||
        row.state === 'conflict' ||
        row.state === 'error' ||
        row.nextAttempt > Date.now()
      )
        continue;
      const dependencies = await offlineDB.outbox.bulkGet(row.dependencies);
      if (dependencies.some((dep) => dep?.state !== 'confirmed')) continue;
      if (
        row.house &&
        row.house !== active.me?.personalSpaceId &&
        !active.me?.roles.some((role) => role.householdId === row.house)
      ) {
        await offlineDB.outbox.update(row.id, { state: 'error', code: 'HOUSE_UNAVAILABLE' });
        continue;
      }
      try {
        // Свежая проверка перед каждой отправкой, в том числе при cookie из другой вкладки.
        const current = await freshMe(active);
        if (!current || current.owner !== row.owner) return;
        active = current;
        await assertIdentity(active);
        const frozen = await freeze(row, active);
        if (!frozen) continue;
        changed();
        const started = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        let response: Response;
        try {
          const blob = frozen.blobId ? await offlineDB.blobs.get(frozen.blobId) : null;
          if (frozen.blobId && !blob) throw new LocalFailure('LOCAL_STORAGE');
          const payload = JSON.parse(frozen.frozenBody ?? '{}') as Record<string, unknown>;
          const headers: Record<string, string> = blob
            ? {
                'X-Offline': 'true',
                'X-Owner-Account-Id': row.owner,
                'Idempotency-Key': row.id,
                'X-Expected-Updated-At': String(payload.expectedUpdatedAt),
              }
            : { 'Content-Type': 'application/json' };
          let body: string | FormData = frozen.frozenBody ?? '{}';
          if (blob) {
            const form = new FormData();
            form.append('file', blob.blob, blob.name);
            body = form;
          }
          response = await fetch(`/api/${frozen.frozenPath}`, {
            method: row.method,
            credentials: 'same-origin',
            cache: 'no-store',
            headers,
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          const code = typeof json?.code === 'string' ? json.code : 'HTTP_ERROR';
          if (response.status === 401) {
            await blockIdentity();
            await offlineDB.outbox.update(row.id, {
              state: 'error',
              httpStatus: 401,
              code: 'SIGN_IN_REQUIRED',
            });
            return;
          }
          if (response.status === 429) {
            const seconds = Number(response.headers.get('retry-after'));
            await offlineDB.outbox.update(row.id, {
              state: 'unknown',
              code: 'RATE_LIMIT',
              nextAttempt:
                Date.now() + Math.max(1000, (Number.isFinite(seconds) ? seconds : 60) * 1000),
            });
            continue;
          }
          if (response.status >= 500) throw new Error('NETWORK');
          await offlineDB.outbox.update(row.id, {
            state: response.status === 409 ? 'conflict' : 'error',
            httpStatus: response.status,
            code,
          });
          changed();
          continue;
        }
        if (json && typeof json === 'object')
          timing.set(json, {
            serverDate: response.headers.get('date'),
            elapsed: performance.now() - started,
            receivedAt: performance.now(),
          });
        if (json && typeof json === 'object') {
          const info = timing.get(json);
          if (info) lastTiming.set(row.id, info);
        }
        const source = Array.isArray(json) ? json[0] : json;
        const receipt = OperationReceipt.safeParse(source?.receipt);
        if (
          !receipt.success ||
          receipt.data.ownerAccountId !== row.owner ||
          receipt.data.key !== row.id ||
          receipt.data.operation !== row.operation
        )
          throw new Error('INVALID_RECEIPT');
        await offlineDB.transaction(
          'rw',
          offlineDB.identity,
          offlineDB.outbox,
          offlineDB.drafts,
          offlineDB.blobs,
          async () => {
            await assertIdentity(active);
            await offlineDB.outbox.update(row.id, {
              state: 'confirmed',
              receipt: receipt.data,
              response: json,
              code: undefined,
            });
            await offlineDB.drafts.delete(row.id);
            if (row.operation === 'reading_create' || row.operation === 'readings_create') {
              for (const dep of dependencies)
                if (dep?.blobId) await offlineDB.blobs.delete(dep.blobId);
            }
          },
        );
        changed();
      } catch (error) {
        if (error instanceof LocalFailure && error.code === 'ACCOUNT_CHANGED') return;
        const attempts = row.attempts + 1;
        await offlineDB.outbox.update(row.id, {
          state: 'unknown',
          attempts,
          code: 'OUTCOME_UNKNOWN',
          nextAttempt: Date.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
        });
        changed();
      }
    }
    await offlineDB.transaction('rw', offlineDB.identity, offlineDB.outbox, async () => {
      await assertIdentity(active);
      const rows = await offlineDB.outbox
        .where('owner')
        .equals(active.owner ?? '')
        .toArray();
      const referenced = new Set(
        rows.filter((row) => row.state !== 'confirmed').flatMap((row) => row.dependencies),
      );
      const confirmed = rows
        .filter((row) => row.state === 'confirmed' && !row.formKey && !referenced.has(row.id))
        .toSorted((a, b) => b.createdAt - a.createdAt);
      for (const old of confirmed.slice(200)) await offlineDB.outbox.delete(old.id);
    });
  } finally {
    await offlineDB.transaction('rw', offlineDB.leases, async () => {
      const lease = await offlineDB.leases.get('sender');
      if (lease?.holder === holder) await offlineDB.leases.delete('sender');
    });
  }
}
async function freeze(row: Intent, active: Identity) {
  return offlineDB.transaction('rw', offlineDB.identity, offlineDB.outbox, async () => {
    await assertIdentity(active);
    const current = await offlineDB.outbox.get(row.id);
    if (
      !current ||
      current.owner !== active.owner ||
      !['pending', 'sending', 'unknown'].includes(current.state)
    )
      return null;
    row = current;
    if (row.attempted) return row;
    const body = structuredClone(row.body);
    let path = row.path;
    if (row.idFrom) {
      const parent = await offlineDB.outbox.get(row.idFrom);
      const id = parent?.receipt?.results[0]?.id;
      if (!id) throw new LocalFailure('EXACT_VERSION_REQUIRED');
      path = path.replace(`local:${row.idFrom}`, id);
    }
    const checklistIds = new Map<string, { id: string }>();
    const ancestorIds = [...row.dependencies];
    const seen = new Set<string>();
    while (ancestorIds.length) {
      const id = ancestorIds.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const ancestor = await offlineDB.outbox.get(id);
      for (const item of ancestor?.receipt?.checklist ?? [])
        if (item.clientId) checklistIds.set(item.clientId, item);
      ancestorIds.push(...(ancestor?.dependencies ?? []));
    }
    if (row.baseFrom) {
      const parent = await offlineDB.outbox.get(row.baseFrom);
      const version =
        row.operation === 'file_upload'
          ? parent?.receipt?.parent?.updatedAt
          : parent?.receipt?.results[0]?.updatedAt;
      if (!version) throw new LocalFailure('EXACT_VERSION_REQUIRED');
      body.expectedUpdatedAt = version;
      if (row.operation === 'note_patch' && Array.isArray(body.checklist)) {
        body.checklist = body.checklist.map((raw) => {
          const item = raw as Record<string, unknown>;
          const match =
            parent?.receipt?.checklist?.find((value) => value.clientId === item.clientId) ??
            checklistIds.get(String(item.clientId));
          if (!match) return item;
          const { clientId: _client, ...rest } = item;
          return { ...rest, id: match.id };
        });
      }
    }
    if (row.photoFrom) {
      const ids: Record<string, string[]> = {};
      for (const [meter, refs] of Object.entries(row.photoFrom)) {
        ids[meter] = [];
        for (const ref of refs) {
          const photo = await offlineDB.outbox.get(ref);
          const id = photo?.receipt?.results[0]?.id;
          if (!id) throw new LocalFailure('EXACT_VERSION_REQUIRED');
          ids[meter]?.push(id);
        }
      }
      if (row.operation === 'readings_create' && Array.isArray(body.readings))
        body.readings = body.readings.map((raw) => {
          const item = raw as Record<string, unknown>;
          return {
            ...item,
            photoIds: [
              ...((item.photoIds as string[]) ?? []),
              ...(ids[String(item.meterId)] ?? []),
            ],
          };
        });
      else body.photoIds = [...((body.photoIds as string[]) ?? []), ...Object.values(ids).flat()];
    }
    const def = definition(row.method, path);
    if (def) def.schema.parse(body);
    const frozen = {
      ...row,
      body,
      frozenBody: JSON.stringify(body),
      frozenPath: path,
      attempted: true,
      state: 'sending' as const,
    };
    await offlineDB.outbox.put(frozen);
    return frozen;
  });
}
