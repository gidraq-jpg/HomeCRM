import { describe, expect, it } from 'vitest';
import {
  areaToInput,
  EMPTY_PROPERTY,
  formatArea,
  parseArea,
  propertyDraft,
  toggleOwner,
  toPropertyData,
} from './property.ts';

const NBSP = String.fromCodePoint(0xa0);

describe('площадь недвижимости', () => {
  it('«54,3» хранится целыми сотыми, запятая и точка равны', () => {
    expect(parseArea('54,3')).toEqual({ ok: true, hundredths: 5430 });
    expect(parseArea('54.30')).toEqual({ ok: true, hundredths: 5430 });
    expect(parseArea(' 57,31 м² ')).toEqual({ ok: true, hundredths: 5731 });
    expect(parseArea('54')).toEqual({ ok: true, hundredths: 5400 });
    expect(parseArea('0,05')).toEqual({ ok: true, hundredths: 5 });
  });

  it('«54,» и «,5» при наборе на телефоне принимаются', () => {
    expect(parseArea('54,')).toEqual({ ok: true, hundredths: 5400 });
    expect(parseArea(',5')).toEqual({ ok: true, hundredths: 50 });
    expect(parseArea('.')).toEqual({ ok: false });
    expect(parseArea(',')).toEqual({ ok: false });
  });

  it('пустая строка — площади нет; мусор, минус и три знака отклоняются', () => {
    expect(parseArea('  ')).toEqual({ ok: true, hundredths: null });
    for (const bad of ['abc', '-5', '54,333', '1,2,3', '1e3'])
      expect(parseArea(bad), bad).toEqual({ ok: false });
  });

  it('обратно в поле ввода и на экран без лишних нулей', () => {
    expect(areaToInput(5430)).toBe('54,3');
    expect(areaToInput(5731)).toBe('57,31');
    expect(areaToInput(5400)).toBe('54');
    expect(areaToInput(5)).toBe('0,05');
    expect(formatArea(5430)).toBe(`54,3${NBSP}м²`);
  });
});

describe('поля недвижимости в форме', () => {
  it('пустая форма даёт пустые поля: PATCH заменяет их целиком', () => {
    expect(toPropertyData(EMPTY_PROPERTY)).toEqual({ ok: true, data: {} });
  });

  it('заполненная форма превращается в данные API', () => {
    const result = toPropertyData({
      kind: 'apartment',
      address: '  Вымышленная улица, 1 ',
      area: '54,3',
      cadastralNumber: '66:41:0101001:123',
      status: 'living',
      ownerMemberIds: ['a'],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'apartment',
        address: 'Вымышленная улица, 1',
        areaHundredths: 5430,
        cadastralNumber: '66:41:0101001:123',
        status: 'living',
        ownerMemberIds: ['a'],
      },
    });
  });

  it('ошибки формата названы у поля', () => {
    const result = toPropertyData({ ...EMPTY_PROPERTY, area: 'много', cadastralNumber: '66:41' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.area).toContain('54,3');
      expect(result.errors.cadastralNumber).toContain('66:41:0101001:123');
    }
  });

  it('форма правки начинается с сохранённых значений', () => {
    expect(propertyDraft({ areaHundredths: 5731, status: 'rented' })).toEqual({
      ...EMPTY_PROPERTY,
      area: '57,31',
      status: 'rented',
    });
  });

  it('собственник добавляется и убирается без повторов', () => {
    expect(toggleOwner(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleOwner(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleOwner(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});
