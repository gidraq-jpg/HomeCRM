import type { Api } from './notes-support.ts';

// Счётчики и показания (R1a.5b). Семья вымышленная; всё заводится через API, а проверяется на
// экране. Заводские номера и значения выдуманные: в журнал и хранилища они попасть не должны.

export interface SeededMeter {
  id: string;
  title: string;
  initialReading: { id: string } | null;
}

export interface MeterSeed {
  title: string;
  utilityAccountId?: string;
  data: Record<string, unknown>;
  initial?: { occurredOn: string; values: string[] };
}

export async function seedMeter(
  api: Api,
  objectId: string,
  meter: MeterSeed,
): Promise<SeededMeter> {
  const created = await api.post(`objects/${objectId}/meters`, {
    title: meter.title,
    ...(meter.utilityAccountId ? { utilityAccountId: meter.utilityAccountId } : {}),
    data: meter.data,
    ...(meter.initial ? { initialReading: meter.initial } : {}),
  });
  if (created.status !== 201) throw new Error(`Test meter was not created: ${created.status}`);
  return created.body as SeededMeter;
}

export async function seedReading(
  api: Api,
  meterId: string,
  occurredOn: string,
  values: string[],
): Promise<void> {
  const created = await api.post(`meters/${meterId}/readings`, { occurredOn, values });
  if (created.status !== 201) throw new Error(`Test reading was not created: ${created.status}`);
}

/** Прошлые показания вымышленной квартиры: июль, август и сентябрь — по 10 единиц в месяц. */
export const HISTORY = ['2026-07-20', '2026-08-20', '2026-09-20'] as const;
