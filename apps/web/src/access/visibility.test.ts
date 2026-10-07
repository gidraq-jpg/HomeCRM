import { describe, expect, it } from 'vitest';
import { SCOPES } from './scope.ts';
import {
  defaultObjectVisibility,
  defaultVisibility,
  isVisibility,
  type NewRecordKind,
  VISIBILITIES,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
} from './visibility.ts';
import { type HouseMember, whoLosesAccess, whoSees } from './who-sees.ts';

const KINDS: readonly NewRecordKind[] = [
  'task',
  'note',
  'shopping',
  'document',
  'contact',
  'property',
];

describe('значки и подписи доступа', () => {
  it('подписи — как в PRD, раздел 7.4', () => {
    expect(VISIBILITY_LABELS).toEqual({
      personal: 'Только я',
      adults: 'Взрослые',
      household: 'Вся семья',
    });
    for (const visibility of VISIBILITIES) {
      expect(VISIBILITY_HINTS[visibility].length).toBeGreaterThan(10);
    }
  });

  it('распознаёт только известные значения', () => {
    expect(isVisibility('adults')).toBe(true);
    expect(isVisibility('shared')).toBe(false);
  });
});

describe('значение «Кто видит» по умолчанию', () => {
  it('в режиме «Личное» всё личное', () => {
    for (const kind of KINDS) expect(defaultVisibility(kind, 'personal')).toBe('personal');
  });

  it('в режиме «Личное» личное и внутри общего объекта', () => {
    expect(defaultVisibility('note', 'personal', { parent: 'adults' })).toBe('personal');
  });

  it('в режиме «Общее» всё общее', () => {
    for (const kind of KINDS) expect(defaultVisibility(kind, 'shared')).not.toBe('personal');
    expect(defaultVisibility('property', 'shared')).toBe('adults');
    expect(defaultVisibility('shopping', 'shared')).toBe('household');
  });

  it('в режиме «Всё» — по таблице 7.2', () => {
    expect(defaultVisibility('property', 'all')).toBe('adults');
    expect(defaultVisibility('document', 'all')).toBe('personal');
    expect(defaultVisibility('note', 'all')).toBe('personal');
    expect(defaultVisibility('task', 'all')).toBe('personal');
    expect(defaultVisibility('shopping', 'all')).toBe('household');
    expect(defaultVisibility('contact', 'all')).toBe('personal');
  });

  it('организации и мастера общие для всей семьи', () => {
    expect(defaultVisibility('contact', 'all', { sharedByNature: true })).toBe('household');
  });

  it('в карточке общего объекта дела, заметки и документы наследуют его доступ', () => {
    for (const kind of ['task', 'note', 'document'] as const) {
      expect(defaultVisibility(kind, 'all', { parent: 'adults' })).toBe('adults');
      expect(defaultVisibility(kind, 'shared', { parent: 'household' })).toBe('household');
    }
    expect(defaultVisibility('shopping', 'all', { parent: 'adults' })).toBe('household');
  });

  it('любой результат — допустимое значение', () => {
    for (const scope of SCOPES) {
      for (const kind of KINDS) {
        expect(isVisibility(defaultVisibility(kind, scope))).toBe(true);
      }
    }
  });

  it('у объекта любого типа — «Взрослые», как у недвижимости (таблица 7.2)', () => {
    for (const type of ['property', 'car', 'appliance', 'other'] as const) {
      expect(defaultObjectVisibility(type, 'all')).toBe('adults');
      expect(defaultObjectVisibility(type, 'shared')).toBe('adults');
      expect(defaultObjectVisibility(type, 'personal')).toBe('personal');
    }
  });
});

const HOUSE: readonly HouseMember[] = [
  { id: 'anna', name: 'Анна', role: 'adult' },
  { id: 'igor', name: 'Игорь', role: 'admin' },
  { id: 'nika', name: 'Ника', role: 'child' },
];

const names = (members: readonly HouseMember[]) => members.map((member) => member.name);

describe('кто видит запись — по эталонным правилам из общего пакета', () => {
  it('личное видит только владелец, администратор не видит', () => {
    expect(names(whoSees('personal', 'anna', HOUSE))).toEqual(['Анна']);
  });

  it('«Взрослые» видят администратор и взрослые, ребёнок — нет', () => {
    expect(names(whoSees('adults', 'anna', HOUSE))).toEqual(['Анна', 'Игорь']);
  });

  it('«Вся семья» видят все', () => {
    expect(names(whoSees('household', 'anna', HOUSE))).toEqual(['Анна', 'Игорь', 'Ника']);
  });

  it('при сужении показывает, кто потеряет доступ', () => {
    expect(names(whoLosesAccess('household', 'adults', 'anna', HOUSE))).toEqual(['Ника']);
    expect(names(whoLosesAccess('adults', 'personal', 'anna', HOUSE))).toEqual(['Игорь']);
    expect(names(whoLosesAccess('household', 'personal', 'anna', HOUSE))).toEqual([
      'Игорь',
      'Ника',
    ]);
  });

  it('при расширении никто доступ не теряет', () => {
    expect(whoLosesAccess('personal', 'household', 'anna', HOUSE)).toEqual([]);
    expect(whoLosesAccess('adults', 'household', 'anna', HOUSE)).toEqual([]);
  });
});
