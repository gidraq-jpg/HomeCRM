import { TEMPLATES } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import { Template } from './api.ts';
import { buildRequest, initialSelection, placementOf, selectedCount, toggled } from './form.ts';

// Каталог берётся из общего пакета, как его отдаёт сервер: клиентская схема должна его принимать.
const rented = Template.parse(TEMPLATES.find((item) => item.id === 'rented_apartment'));
const house = Template.parse(TEMPLATES.find((item) => item.id === 'house'));

const where = {
  me: { personalSpaceId: 'personal-1' },
  householdId: 'house-1',
  visibility: 'adults' as const,
};
const values = {
  title: ' Вымышленная квартира ',
  address: '',
  readings: {},
  readingDate: '2026-10-08',
};

describe('каталог шаблонов на клиенте', () => {
  it('схема принимает все три шаблона', () => {
    expect(TEMPLATES.map((item) => Template.safeParse(item).success)).toEqual([true, true, true]);
  });

  it('по умолчанию отмечено всё, налоговый режим не выбран', () => {
    const selection = initialSelection(rented);
    expect(selection.accounts.size).toBe(rented.accounts.length);
    expect(selection.meters.size).toBe(rented.meters.length);
    expect(selection.taxRegime).toBe('');
    expect(selectedCount(selection)).toBe(
      rented.accounts.length +
        rented.meters.length +
        rented.organizations.length +
        rented.deadlines.length,
    );
  });
});

describe('запрос на применение шаблона', () => {
  it('снятые галочки не уходят, пустой выбор — просто объект', () => {
    let selection = initialSelection(rented);
    for (const account of rented.accounts) selection = toggled(selection, 'accounts', account.id);
    for (const meter of rented.meters) selection = toggled(selection, 'meters', meter.id);
    for (const item of rented.organizations) {
      selection = toggled(selection, 'organizations', item.id);
    }
    for (const item of rented.deadlines) selection = toggled(selection, 'deadlines', item.id);
    const result = buildRequest(rented, selection, values, where, '2026-10-08');
    expect(result).toEqual({
      ok: true,
      request: {
        title: 'Вымышленная квартира',
        placement: { spaceId: 'house-1', audience: 'adults' },
        accounts: [],
        meters: [],
        organizations: [],
        deadlines: [],
      },
    });
  });

  it('начальное показание с запятой уходит строкой с точкой', () => {
    const selection = { ...initialSelection(rented), taxRegime: 'npd' as const };
    const cold = rented.meters.find((meter) => meter.id === 'cold_water');
    expect(cold).toBeDefined();
    const result = buildRequest(
      rented,
      selection,
      { ...values, address: 'Вымышленная улица, 1', readings: { cold_water: '123,456' } },
      where,
      '2026-10-08',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.propertyData).toEqual({ address: 'Вымышленная улица, 1' });
    expect(result.request.taxRegime).toBe('npd');
    expect(result.request.meters.find((meter) => meter.id === 'cold_water')).toEqual({
      id: 'cold_water',
      initialReading: { occurredOn: '2026-10-08', values: ['123.456'] },
    });
    expect(result.request.meters.find((meter) => meter.id === 'gas')).toEqual({ id: 'gas' });
  });

  it('название обязательно, плохое показание называет счётчик', () => {
    const selection = initialSelection(house);
    const empty = buildRequest(house, selection, { ...values, title: '  ' }, where, '2026-10-08');
    expect(empty.ok).toBe(false);
    const bad = buildRequest(
      house,
      selection,
      { ...values, readings: { electricity: 'много' } },
      where,
      '2026-10-08',
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors.readings)).toEqual(['electricity']);
  });

  it('дата показаний не из будущего', () => {
    const result = buildRequest(
      house,
      initialSelection(house),
      { ...values, readings: { gas: '10' }, readingDate: '2026-10-09' },
      where,
      '2026-10-08',
    );
    expect(result.ok).toBe(false);
  });

  it('личное место — личное пространство и дом календаря; без дома общего места нет', () => {
    expect(placementOf({ ...where, visibility: 'personal' })).toEqual({
      placement: { spaceId: 'personal-1' },
      householdId: 'house-1',
    });
    expect(placementOf({ ...where, householdId: null, visibility: 'adults' })).toBeNull();
    expect(placementOf({ ...where, householdId: null, visibility: 'personal' })).toEqual({
      placement: { spaceId: 'personal-1' },
    });
  });
});
