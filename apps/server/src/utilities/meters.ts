import {
  and,
  desc,
  eq,
  isNull,
  meterReadings,
  meters,
  objectFiles,
  recordLinks,
  sql,
  type Transaction,
  utilityAccounts,
} from '@homecrm/db';
import {
  canRestore,
  canTrash,
  canView,
  consumptionWarning,
  MeterData,
  meterDecimal,
  meterUnits,
  ReadingInput,
  readingConsumption,
  resolveMeterData,
} from '@homecrm/shared';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { getObject } from '../objects/routes.ts';
import {
  columnsOf,
  type DataRoute,
  deny,
  Failure,
  factsOf,
  missing,
  parse,
  placementOf,
  requireWrite,
  version,
} from '../objects/support.ts';
import { publicRecord } from './service.ts';

const Id = z.strictObject({ id: z.uuid() });
const CreateMeter = z.strictObject({
  title: z.string().trim().min(1).max(200).default('Счётчик'),
  utilityAccountId: z.uuid().nullable().default(null),
  data: MeterData,
  initialReading: ReadingInput.optional(),
});
const Batch = z
  .strictObject({
    readings: z
      .array(ReadingInput.extend({ meterId: z.uuid() }))
      .min(1)
      .max(100),
  })
  .refine((b) => new Set(b.readings.map((r) => r.meterId)).size === b.readings.length);
const Transmission = z
  .strictObject({
    readingIds: z.array(z.uuid()).min(1).max(100),
    transmittedAt: z.iso.datetime().optional(),
    method: z.string().trim().min(1).max(200),
  })
  .refine((b) => new Set(b.readingIds).size === b.readingIds.length);
type Meter = typeof meters.$inferSelect;
type Reading = typeof meterReadings.$inferSelect;
const meterSummary = (row: Meter) => ({
  ...publicRecord(row),
  parentId: row.parentId,
  utilityAccountId: row.utilityAccountId,
  previousMeterId: row.previousMeterId,
  data: row.data,
});
const readingSummary = (row: Reading) => ({
  ...publicRecord(row),
  parentId: row.parentId,
  occurredOn: row.occurredOn,
  values: row.values,
  consumption: row.consumption,
  rollover: row.rollover,
  comment: row.comment,
  takenBy: row.authorId,
  transmissionStatus: row.transmittedAt ? 'transmitted' : 'pending',
  transmittedAt: row.transmittedAt,
  transmissionMethod: row.transmissionMethod,
});

async function getMeter(tx: Transaction, account: Account, id: string, lock = false) {
  let [row] = await tx.select().from(meters).where(eq(meters.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  const parent = await getObject(tx, account, row.parentId, lock);
  if (lock) {
    [row] = await tx.select().from(meters).where(eq(meters.id, id)).for('update');
    if (!row) missing();
    requireWrite(account, parent);
  }
  return row;
}
async function accountOf(tx: Transaction, account: Account, objectId: string, id: string | null) {
  if (!id) return;
  const [row] = await tx.select().from(utilityAccounts).where(eq(utilityAccounts.id, id));
  if (
    !row ||
    row.parentId !== objectId ||
    row.deletedAt ||
    !canView(account.viewer, placementOf(row))
  )
    missing();
}
async function historyOf(tx: Transaction, meterId: string, trash = false) {
  return tx
    .select()
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.parentId, meterId),
        trash ? sql`${meterReadings.deletedAt} IS NOT NULL` : isNull(meterReadings.deletedAt),
      ),
    )
    .orderBy(desc(meterReadings.occurredOn), desc(meterReadings.id));
}
async function photosOf(tx: Transaction, reading: Reading) {
  const result = await tx.execute<{ id: string }>(
    sql`SELECT f.id FROM record_links l JOIN object_files f ON f.id=l.right_id WHERE l.left_table='meter_readings' AND l.left_id=${reading.id}::uuid AND l.right_table='object_files' AND l.role='reading_photo' AND l.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY f.id`,
  );
  return result.rows.map((r) => r.id);
}
async function createReading(
  tx: Transaction,
  account: Account,
  meter: Meter,
  input: ReadingInput,
  replacementFinal = false,
) {
  requireWrite(account, meter, 'meter');
  if (meter.data.status !== 'active') throw new Failure(409, 'METER_INACTIVE');
  const history = await historyOf(tx, meter.id);
  const previous = history[0];
  if (
    previous &&
    (input.occurredOn < previous.occurredOn ||
      (input.occurredOn === previous.occurredOn && !replacementFinal))
  )
    throw new Failure(409, 'READING_DATE_ORDER');
  let consumption: string[] | null;
  let values: string[];
  try {
    consumption = readingConsumption(
      meter.data,
      input.values,
      previous?.values ?? null,
      input.rollover,
    );
    values = input.values.map((v) =>
      meterDecimal(meterUnits(v, meter.data), meter.data.fractionDigits),
    );
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof z.ZodError)) throw error;
    throw new Failure(400, 'INVALID_READING');
  }
  // Фото загружается штатным R0.5 API в объект; связь не дублирует блоки и конверты.
  for (const id of input.photoIds) {
    const [file] = await tx.select().from(objectFiles).where(eq(objectFiles.id, id));
    if (
      !file ||
      file.parentId !== meter.parentId ||
      file.deletedAt ||
      !file.mimeType.startsWith('image/') ||
      !canView(account.viewer, placementOf(file))
    )
      missing();
  }
  const [row] = await tx
    .insert(meterReadings)
    .values({
      ...columnsOf(placementOf(meter)),
      parentId: meter.id,
      authorId: account.id,
      title: 'Показание',
      occurredOn: input.occurredOn,
      values,
      consumption,
      rollover: input.rollover,
      comment: input.comment,
    })
    .returning();
  if (!row) deny();
  for (const id of new Set(input.photoIds))
    await tx.insert(recordLinks).values({
      leftTable: 'meter_readings',
      leftId: row.id,
      rightTable: 'object_files',
      rightId: id,
      authorId: account.id,
      role: 'reading_photo',
    });
  const [year, month, day] = input.occurredOn.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(year, month - 7, 1));
  start.setUTCDate(
    Math.min(
      day,
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate(),
    ),
  );
  const cutoff = start.toISOString().slice(0, 10);
  const sampleHistory = [...history];
  const visited = new Set([meter.id]);
  let predecessor = meter.previousMeterId;
  while (predecessor && !visited.has(predecessor)) {
    visited.add(predecessor);
    const prior = await getMeter(tx, account, predecessor);
    if (prior.data.zones.length !== meter.data.zones.length) break;
    sampleHistory.push(...(await historyOf(tx, prior.id)));
    predecessor = prior.previousMeterId;
  }
  const samples = sampleHistory
    .filter((r) => r.occurredOn >= cutoff && r.consumption !== null)
    .map((r) => r.consumption as string[]);
  return {
    ...readingSummary(row),
    photoIds: input.photoIds,
    warnings: consumptionWarning(consumption, samples, meter.data.fractionDigits),
  };
}
async function createMeter(
  tx: Transaction,
  account: Account,
  objectId: string,
  body: z.infer<typeof CreateMeter>,
  previousMeterId: string | null = null,
) {
  const parent = await getObject(tx, account, objectId, true);
  requireWrite(account, parent);
  await accountOf(tx, account, parent.id, body.utilityAccountId);
  const [row] = await tx
    .insert(meters)
    .values({
      ...columnsOf(placementOf(parent)),
      parentId: parent.id,
      authorId: account.id,
      title: body.title,
      utilityAccountId: body.utilityAccountId,
      previousMeterId,
      data: resolveMeterData(body.data),
    })
    .returning();
  if (!row) deny();
  const initialReading = body.initialReading
    ? await createReading(tx, account, row, body.initialReading)
    : null;
  return { ...meterSummary(row), initialReading };
}

export async function meterRoutes(route: DataRoute) {
  route('POST', '/api/objects/:id/meters', 201, async (tx, account, request) =>
    createMeter(tx, account, parse(Id, request.params).id, parse(CreateMeter, request.body)),
  );
  route('GET', '/api/objects/:id/meters', 200, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id);
    const query = parse(
      z.strictObject({
        status: z.enum(['active', 'replaced', 'removed', 'all']).default('active'),
        trash: z.enum(['true', 'false']).default('false'),
      }),
      request.query,
    );
    const rows = await tx
      .select()
      .from(meters)
      .where(
        and(
          eq(meters.parentId, parent.id),
          query.trash === 'true' ? sql`${meters.deletedAt} IS NOT NULL` : isNull(meters.deletedAt),
          query.status === 'all' ? undefined : sql`${meters.data}->>'status'=${query.status}`,
        ),
      )
      .orderBy(meters.createdAt, meters.id);
    const result = [];
    for (const row of rows)
      if (canView(account.viewer, placementOf(row))) {
        const previous = (await historyOf(tx, row.id))[0];
        result.push({
          ...meterSummary(row),
          previousReading: previous ? readingSummary(previous) : null,
        });
      }
    return result;
  });
  route('GET', '/api/meters/:id', 200, async (tx, account, request) =>
    meterSummary(await getMeter(tx, account, parse(Id, request.params).id)),
  );
  route('PATCH', '/api/meters/:id', 200, async (tx, account, request) => {
    const body = parse(
      z
        .strictObject({
          title: z.string().trim().min(1).max(200).optional(),
          utilityAccountId: z.uuid().nullable().optional(),
          data: MeterData.optional(),
          expectedUpdatedAt: z.iso.datetime().optional(),
        })
        .refine(
          (b) => b.title !== undefined || b.utilityAccountId !== undefined || b.data !== undefined,
        ),
      request.body,
    );
    const row = await getMeter(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, row, 'meter');
    version(body.expectedUpdatedAt, row.updatedAt);
    await accountOf(tx, account, row.parentId, body.utilityAccountId ?? null);
    if (
      body.data &&
      body.data.status !== row.data.status &&
      (body.data.status === 'replaced' || row.data.status === 'replaced')
    )
      throw new Failure(409, 'USE_METER_REPLACEMENT');
    const [updated] = await tx
      .update(meters)
      .set({
        title: body.title,
        utilityAccountId: body.utilityAccountId,
        data: body.data ? resolveMeterData(body.data) : undefined,
      })
      .where(eq(meters.id, row.id))
      .returning();
    if (!updated) deny();
    return meterSummary(updated);
  });
  route('GET', '/api/meters/:id/readings', 200, async (tx, account, request) => {
    const row = await getMeter(tx, account, parse(Id, request.params).id);
    const { includePrevious, trash } = parse(
      z.strictObject({
        includePrevious: z.enum(['true', 'false']).default('false'),
        trash: z.enum(['true', 'false']).default('false'),
      }),
      request.query,
    );
    const chain = [row.id];
    let current = row;
    while (includePrevious === 'true' && current.previousMeterId) {
      current = await getMeter(tx, account, current.previousMeterId);
      if (chain.includes(current.id)) throw new Failure(409, 'INVALID_METER_CHAIN');
      chain.push(current.id);
    }
    const result = [];
    for (const id of chain.reverse())
      for (const reading of (await historyOf(tx, id, trash === 'true')).reverse())
        result.push({ ...readingSummary(reading), photoIds: await photosOf(tx, reading) });
    return result;
  });
  route('GET', '/api/readings/:id', 200, async (tx, account, request) => {
    const [row] = await tx
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.id, parse(Id, request.params).id));
    if (!row || !canView(account.viewer, placementOf(row))) missing();
    await getMeter(tx, account, row.parentId);
    return { ...readingSummary(row), photoIds: await photosOf(tx, row) };
  });
  route('POST', '/api/meters/:id/readings', 201, async (tx, account, request) =>
    createReading(
      tx,
      account,
      await getMeter(tx, account, parse(Id, request.params).id, true),
      parse(ReadingInput, request.body),
    ),
  );
  route('POST', '/api/objects/:id/readings', 201, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, parent);
    const body = parse(Batch, request.body);
    const result = [];
    for (const input of [...body.readings].sort((a, b) => a.meterId.localeCompare(b.meterId))) {
      const meter = await getMeter(tx, account, input.meterId, true);
      if (meter.parentId !== parent.id) missing();
      result.push(await createReading(tx, account, meter, input));
    }
    return result;
  });
  route('POST', '/api/meters/:id/replace', 201, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        finalReading: ReadingInput,
        newMeter: CreateMeter.extend({ initialReading: ReadingInput }),
      }),
      request.body,
    );
    const old = await getMeter(tx, account, parse(Id, request.params).id, true);
    if (
      body.newMeter.data.resource !== old.data.resource ||
      body.newMeter.initialReading.occurredOn !== body.finalReading.occurredOn
    )
      throw new Failure(400, 'INVALID_REPLACEMENT');
    const finalReading = await createReading(tx, account, old, body.finalReading, true);
    await tx
      .update(meters)
      .set({ data: { ...old.data, status: 'replaced' } })
      .where(eq(meters.id, old.id));
    const newMeter = await createMeter(
      tx,
      account,
      old.parentId,
      {
        ...body.newMeter,
        utilityAccountId: body.newMeter.utilityAccountId ?? old.utilityAccountId,
        data: { ...body.newMeter.data, status: 'active' },
      },
      old.id,
    );
    return { oldMeterId: old.id, finalReading, newMeter };
  });
  route('GET', '/api/objects/:id/transmission', 200, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id);
    const rows = await tx
      .select()
      .from(meters)
      .where(and(eq(meters.parentId, parent.id), isNull(meters.deletedAt)));
    const groups = new Map<
      string,
      {
        utilityAccountId: string | null;
        number: string;
        transmission: unknown;
        readings: unknown[];
      }
    >();
    for (const meter of rows) {
      if (!canView(account.viewer, placementOf(meter))) continue;
      const readings = (await historyOf(tx, meter.id))
        .slice(0, 1)
        .filter((r) => r.transmittedAt === null);
      if (!readings.length) continue;
      const [linked] = meter.utilityAccountId
        ? await tx
            .select()
            .from(utilityAccounts)
            .where(
              and(
                eq(utilityAccounts.id, meter.utilityAccountId),
                isNull(utilityAccounts.deletedAt),
              ),
            )
        : [];
      const key = linked?.id ?? '';
      const group = groups.get(key) ?? {
        utilityAccountId: linked?.id ?? null,
        number: linked?.data.number ?? '',
        transmission: linked?.data.transmission ?? null,
        readings: [],
      };
      group.readings.push(
        ...readings.map((r) => ({
          ...readingSummary(r),
          meterId: meter.id,
          zones: meter.data.zones,
          serialNumber: meter.data.serialNumber,
          installationPlace: meter.data.installationPlace,
        })),
      );
      groups.set(key, group);
    }
    return [...groups.values()];
  });
  route('POST', '/api/objects/:id/readings/transmit', 200, async (tx, account, request) => {
    const parent = await getObject(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, parent);
    const body = parse(Transmission, request.body);
    const result = [];
    for (const id of [...body.readingIds].sort()) {
      const [row] = await tx.select().from(meterReadings).where(eq(meterReadings.id, id));
      if (!row) missing();
      const meter = await getMeter(tx, account, row.parentId, true);
      if (meter.parentId !== parent.id || meter.deletedAt) missing();
      requireWrite(account, row, 'meter_reading');
      if (row.transmittedAt) {
        result.push(readingSummary(row));
        continue;
      }
      const [updated] = await tx
        .update(meterReadings)
        .set({
          transmittedAt: body.transmittedAt ? new Date(body.transmittedAt) : new Date(),
          transmissionMethod: body.method,
        })
        .where(eq(meterReadings.id, id))
        .returning();
      if (!updated) deny();
      result.push(readingSummary(updated));
    }
    return result;
  });
  for (const type of ['meter', 'meter_reading'] as const)
    for (const action of ['trash', 'restore'] as const) {
      const handler = async (
        tx: Transaction,
        account: Account,
        request: { params: unknown; body?: unknown },
      ) => {
        parse(z.strictObject({}), request.body ?? {});
        const id = parse(Id, request.params).id;
        const table = type === 'meter' ? meters : meterReadings;
        const [row] = await tx.select().from(table).where(eq(table.id, id));
        if (!row || !canView(account.viewer, placementOf(row))) missing();
        const meter = await getMeter(tx, account, type === 'meter' ? row.id : row.parentId, true);
        if (
          action === 'trash'
            ? !canTrash(account.viewer, factsOf(row, type))
            : !canRestore(account.viewer, factsOf(row, type))
        )
          deny();
        if (type === 'meter_reading') {
          if (meter.deletedAt) deny();
          const latest = (await historyOf(tx, meter.id))[0];
          if (
            latest &&
            (action === 'trash'
              ? latest.id !== row.id
              : latest.occurredOn >= (row as Reading).occurredOn)
          )
            throw new Failure(409, 'READING_DATE_ORDER');
        }
        const consumption =
          type === 'meter_reading' && action === 'restore'
            ? readingConsumption(
                meter.data,
                (row as Reading).values,
                (await historyOf(tx, meter.id))[0]?.values ?? null,
                (row as Reading).rollover,
              )
            : undefined;
        const [updated] = await tx
          .update(table)
          .set({ deletedAt: action === 'trash' ? new Date() : null })
          .where(eq(table.id, id))
          .returning();
        if (!updated) deny();
        if (type === 'meter_reading' && action === 'restore')
          await tx.update(meterReadings).set({ consumption }).where(eq(meterReadings.id, id));
        return { id: updated.id, deletedAt: updated.deletedAt };
      };
      const path = type === 'meter' ? 'meters' : 'readings';
      route('POST', `/api/${path}/:id/${action}`, 200, handler);
      if (action === 'trash') route('DELETE', `/api/${path}/:id`, 200, handler);
    }
}
