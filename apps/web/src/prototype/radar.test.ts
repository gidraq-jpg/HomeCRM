import { describe, expect, it } from 'vitest';
import { filterByScope } from '../access/scope.ts';
import { SEED_RECORDS, TODAY } from './data/index.ts';
import { buildRadar, groupForDays, nextOccurrence, openWindows, type RadarItem } from './radar.ts';

const NBSP = String.fromCodePoint(0xa0);
const plain = (text: string) => text.replaceAll(NBSP, ' ');
const radar = () => buildRadar(SEED_RECORDS, {}, TODAY);
const find = (items: readonly RadarItem[], id: string) => items.find((item) => item.id === id);

describe('горизонты радара', () => {
  it('делят сроки на группы по числу дней', () => {
    expect([-3, 0, 1, 7, 8, 30, 31, 90, 91].map((days) => groupForDays(days))).toEqual([
      'overdue',
      'now',
      'week',
      'week',
      'month',
      'month',
      'quarter',
      'quarter',
      null,
    ]);
  });

  it('ближайший день рождения — в этом году или в следующем', () => {
    expect(nextOccurrence('2011-10-28', '2026-10-22')).toBe('2026-10-28');
    expect(nextOccurrence('1989-03-14', '2026-10-22')).toBe('2027-03-14');
    expect(nextOccurrence('2011-10-22', '2026-10-22')).toBe('2026-10-22');
  });
});

describe('открытые окна показаний', () => {
  it('сегодня открыты окна квартиры, где живёт семья, и сдаваемой квартиры', () => {
    const windows = openWindows(SEED_RECORDS, {}, TODAY);
    expect(windows.map((window) => window.propertyId).sort()).toEqual(['rechnaya', 'sadovaya']);
  });

  it('у квартиры на Садовой окно по воде и электроэнергии — до 25 октября', () => {
    const window = openWindows(SEED_RECORDS, {}, TODAY).find((w) => w.propertyId === 'sadovaya');
    expect(window?.until).toBe('2026-10-25');
    expect(window?.resources).toEqual(['вода', 'электроэнергия']);
    expect(window?.meterCount).toBe(5);
    expect(window?.status).toBe('live');
  });

  it('у сдаваемой квартиры срок другой — до 23 октября', () => {
    const window = openWindows(SEED_RECORDS, {}, TODAY).find((w) => w.propertyId === 'rechnaya');
    expect(window?.until).toBe('2026-10-23');
    expect(window?.status).toBe('rent');
  });

  it('после «Отметить переданными» окно закрывается', () => {
    const readings = { sadovaya: { values: {}, transmitted: true } };
    const items = buildRadar(SEED_RECORDS, readings, TODAY);
    expect(find(items, 'window-sadovaya')).toBeUndefined();
    expect(find(items, 'window-rechnaya')).toBeDefined();
  });
});

describe('радар на вымышленных данных', () => {
  it('просроченное и срочное сегодня', () => {
    const items = radar();
    expect(find(items, 'payment-ch-sad-capital')?.group).toBe('overdue');
    expect(find(items, 'document-doc-heater-warranty')?.group).toBe('overdue');
    expect(find(items, 'payment-ch-sad-power')?.group).toBe('now');
  });

  it('страховка дачи — в горизонте 30 дней, с датой окончания', () => {
    const item = find(radar(), 'document-doc-dacha-insurance');
    expect(item?.group).toBe('month');
    expect(plain(item?.detail ?? '')).toContain('14 нояб.');
  });

  it('день рождения Ники — в горизонте 7 дней, виден всей семье', () => {
    const item = find(radar(), 'birthday-nika');
    expect(item?.group).toBe('week');
    expect(item?.visibility).toBe('household');
    expect(item?.detail).toContain('исполнится 15');
  });

  it('личное попадает в радар, но только в режимы «Всё» и «Личное»', () => {
    const items = radar();
    const passport = find(items, 'document-doc-intl-passport');
    expect(passport?.visibility).toBe('personal');
    expect(filterByScope(items, 'personal').map((item) => item.id)).toContain(passport?.id);
    expect(filterByScope(items, 'shared').map((item) => item.id)).not.toContain(passport?.id);
  });

  it('в режиме «Личное» остаются только личные пункты', () => {
    const personal = filterByScope(radar(), 'personal');
    expect(personal.length).toBeGreaterThan(0);
    expect(personal.every((item) => item.visibility === 'personal')).toBe(true);
  });

  it('группы идут по порядку горизонтов', () => {
    const order = ['overdue', 'now', 'week', 'month', 'quarter'];
    const groups = radar().map((item) => order.indexOf(item.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });
});
