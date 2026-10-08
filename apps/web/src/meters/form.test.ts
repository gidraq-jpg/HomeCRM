import { MeterData } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import type { MeterCard } from './api.ts';
import {
  computedNextVerification,
  emptyMeterDraft,
  meterDraft,
  toMeterInput,
  toMeterPatch,
  withZoneCount,
} from './form.ts';

const TODAY = '2026-10-20';

function card(data: Record<string, unknown> = {}): MeterCard {
  return {
    id: 'm',
    title: 'ХВС, санузел',
    spaceId: 's',
    spaceKind: 'household',
    audience: 'adults',
    authorId: 'u',
    assigneeId: 'u',
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    deletedAt: null,
    parentId: 'o',
    utilityAccountId: null,
    previousMeterId: null,
    data: MeterData.parse({
      resource: 'cold_water',
      installationPlace: 'Санузел',
      verifiedOn: '2020-10-08',
      verificationYears: 6,
      nextVerificationOn: '2026-10-08',
      unit: 'м³',
      ...data,
    }),
  };
}

describe('форма счётчика', () => {
  it('достаточно ресурса: название из ресурса и места, одна зона, 5 и 3 разряда', () => {
    const result = toMeterInput(
      { ...emptyMeterDraft(TODAY), place: 'Санузел' },
      { initialRequired: false, structureLocked: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.title).toBe('ХВС, Санузел');
    expect(result.input.data).toMatchObject({
      resource: 'cold_water',
      zones: ['Основная'],
      integerDigits: 5,
      fractionDigits: 3,
      verifiedOn: null,
    });
    expect(result.input.initialReading).toBeUndefined();
    expect(MeterData.safeParse(result.input.data).success).toBe(true);
  });

  it('начальное показание: все зоны обязательны, запятая и точка равны', () => {
    const draft = withZoneCount(emptyMeterDraft(TODAY, 'electricity'), 2);
    expect(draft.zones.slice(0, 2)).toEqual(['День', 'Ночь']);
    const partial = toMeterInput(
      { ...draft, initialValues: ['100,5', '', ''] },
      { initialRequired: false, structureLocked: false },
    );
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors.initialValues?.[1]).toContain('«Ночь»');
    const full = toMeterInput(
      { ...draft, initialValues: ['100,5', '50.25', ''] },
      { initialRequired: false, structureLocked: false },
    );
    expect(full.ok && full.input.initialReading).toEqual({
      occurredOn: TODAY,
      values: ['100.500', '50.250'],
    });
  });

  it('ошибки формата названы у поля', () => {
    const result = toMeterInput(
      {
        ...emptyMeterDraft(TODAY),
        integerDigits: '15',
        fractionDigits: 'x',
        verifiedOn: '2020-13-40',
        verificationYears: '99',
        initialValues: ['12,3456', '', ''],
      },
      { initialRequired: false, structureLocked: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.integerDigits).toContain('от 1 до 12');
    expect(result.errors.fractionDigits).toContain('от 0 до 6');
    expect(result.errors.verifiedOn).toContain('полностью');
    expect(result.errors.verificationYears).toContain('от 1 до 50');
  });

  it('замена требует начальное показание нового счётчика', () => {
    const result = toMeterInput(emptyMeterDraft(TODAY), {
      initialRequired: true,
      structureLocked: false,
    });
    expect(!result.ok && result.errors.initialValues?.[0]).toContain('Введите показание');
  });

  it('дата следующей поверки вычисляется из приложения А и правится вручную', () => {
    expect(computedNextVerification('cold_water', '2020-10-08', '')).toBe('2026-10-08');
    expect(computedNextVerification('electricity', '2020-10-08', '')).toBe('2036-10-08');
    expect(computedNextVerification('cold_water', '2020-10-08', '4')).toBe('2024-10-08');
    expect(computedNextVerification('cold_water', '', '')).toBeNull();
    const draft = { ...emptyMeterDraft(TODAY), verifiedOn: '2020-10-08' };
    const auto = toMeterInput(draft, { initialRequired: false, structureLocked: false });
    expect(auto.ok && auto.input.data.nextVerificationOn).toBeUndefined();
    const manual = toMeterInput(
      { ...draft, nextVerificationOn: '2027-01-15', nextManual: true },
      { initialRequired: false, structureLocked: false },
    );
    expect(manual.ok && manual.input.data.nextVerificationOn).toBe('2027-01-15');
  });
});

describe('правка счётчика', () => {
  it('поправленную вручную дату поверки сохраняет, пока дату поверки и интервал не меняли', () => {
    const original = card({ nextVerificationOn: '2027-03-01' });
    const draft = { ...meterDraft(original, TODAY), serialNumber: 'FICTION-1' };
    const same = toMeterPatch(draft, original);
    expect(same.ok && same.data.nextVerificationOn).toBe('2027-03-01');
    expect(same.ok && same.data.serialNumber).toBe('FICTION-1');
    const moved = toMeterPatch({ ...draft, verifiedOn: '2021-01-01' }, original);
    expect(moved.ok && 'nextVerificationOn' in moved.data).toBe(false);
  });

  it('зоны, разрядность и ресурс берутся из карточки, а не из формы', () => {
    const original = card({ zones: ['День', 'Ночь'], integerDigits: 6, fractionDigits: 1 });
    const result = toMeterPatch(
      { ...meterDraft(original, TODAY), integerDigits: '2', zoneCount: 1, resource: 'gas' },
      original,
    );
    expect(result.ok && result.data).toMatchObject({
      resource: 'cold_water',
      zones: ['День', 'Ночь'],
      integerDigits: 6,
      fractionDigits: 1,
      unit: 'м³',
    });
  });
});
