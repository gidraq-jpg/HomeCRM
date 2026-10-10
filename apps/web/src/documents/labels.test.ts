import { describe, expect, it } from 'vitest';
import { defaultDocumentVisibility, documentVisibilityOptions, NO_OWNER } from './access.ts';
import {
  expiryInfo,
  expirySource,
  MASKED_NUMBER,
  seriesAndNumber,
  warningsLabel,
} from './labels.ts';

const TODAY = '2026-10-09' as const;
const NBSP = String.fromCodePoint(0xa0);
const base = { expiresOn: null as string | null, indefinite: false };

describe('срок документа словами (PRD 13)', () => {
  it('просрочен, истекает и действует — всегда с текстом', () => {
    expect(expiryInfo({ ...base, expiresOn: '2026-10-06' }, true, TODAY)).toMatchObject({
      tone: 'danger',
      label: 'Просрочен на 3 дня',
    });
    expect(expiryInfo({ ...base, expiresOn: '2026-10-09' }, true, TODAY)).toMatchObject({
      tone: 'warning',
      label: 'Истекает сегодня',
    });
    expect(expiryInfo({ ...base, expiresOn: '2026-11-01' }, true, TODAY)).toMatchObject({
      tone: 'warning',
      label: 'Истекает через 23 дня',
    });
    expect(expiryInfo({ ...base, expiresOn: '2027-01-07' }, true, TODAY)).toMatchObject({
      tone: 'warning',
      label: 'Истекает через 90 дней',
    });
    const far = expiryInfo({ ...base, expiresOn: '2027-01-08' }, true, TODAY);
    expect(far.tone).toBe('ok');
    expect(far.label.replaceAll(NBSP, ' ')).toBe('Действует до 8 янв. 2027');
  });

  it('бессрочный, без срока и недействительный', () => {
    expect(expiryInfo({ ...base, indefinite: true }, true, TODAY).label).toBe('Бессрочно');
    expect(expiryInfo(base, true, TODAY).label).toBe('Срок не указан');
    expect(expiryInfo({ ...base, expiresOn: '2030-01-01' }, false, TODAY)).toMatchObject({
      tone: 'neutral',
      label: 'Недействителен',
    });
  });
});

describe('срок паспорта РФ по возрасту (DOC-4)', () => {
  const passport = { ...base, type: 'russian_passport' as const, issuedOn: '2020-01-01' };
  const window = {
    kind: 'window',
    date: '2026-12-01',
    durationDays: 90,
    passportYears: 20 as const,
  };

  it('окно замены даёт срок до конца окна и подсказку про 20 лет', () => {
    expect(expirySource(passport, window)).toEqual({
      kind: 'age',
      start: '2026-12-01',
      until: '2027-03-01',
      years: 20,
    });
    expect(expiryInfo(passport, true, TODAY, window).tone).toBe('ok');
    expect(expiryInfo(passport, true, '2027-02-01', window)).toMatchObject({
      tone: 'warning',
      label: 'Истекает через 28 дней',
    });
  });

  it('граница берётся из API независимо от даты выдачи; без границы возраст не угадывается', () => {
    const late = { ...passport, issuedOn: '2002-01-01' };
    expect(expirySource(late, { ...window, passportYears: 45, date: '2031-05-14' })).toMatchObject({
      years: 45,
    });
    const unclear = { ...passport, issuedOn: '2016-01-01' };
    expect(expirySource(unclear, window)).toMatchObject({ years: 20 });
    expect(expirySource({ ...passport, issuedOn: null }, window)).toMatchObject({ years: 20 });
    expect(
      expirySource(passport, { kind: 'window', date: window.date, durationDays: 90 }),
    ).toMatchObject({ years: null });
  });

  it('явный срок и бессрочность важнее вычисленного', () => {
    const explicit = { ...passport, expiresOn: '2030-01-01' };
    expect(expirySource(explicit, window)).toEqual({ kind: 'explicit', until: '2030-01-01' });
    expect(expirySource({ ...passport, indefinite: true }, window)).toEqual({ kind: 'indefinite' });
  });

  it('без даты рождения срок ждёт данные и не раскрывает ничего лишнего', () => {
    const waiting = { kind: 'after', eventDate: null };
    expect(expirySource(passport, waiting)).toEqual({ kind: 'pending' });
    expect(expiryInfo(passport, true, TODAY, waiting).label).toBe(
      'Срок вычислится по дате рождения',
    );
    // Другие типы документов вычисленных сроков не получают.
    expect(expirySource({ ...passport, type: 'osago' }, window)).toEqual({ kind: 'none' });
  });
});

describe('серия и номер', () => {
  it('склеиваются одной строкой, пустые части отбрасываются', () => {
    expect(seriesAndNumber({ series: '45 12', number: '000000' })).toBe('45 12 000000');
    expect(seriesAndNumber({ series: '', number: '000000' })).toBe('000000');
    expect(seriesAndNumber({ series: '', number: '' })).toBe('');
  });

  it('маска не выдаёт длину номера', () => {
    expect(MASKED_NUMBER).toBe('•••• ••••••');
  });
});

describe('предупреждения словами', () => {
  it('по убыванию, с «в день срока»', () => {
    expect(warningsLabel([30, 180, 90])).toBe('за 180, 90 и 30 дней');
    expect(warningsLabel([30, 7])).toBe('за 30 и 7 дней');
    expect(warningsLabel([30])).toBe('за 30 дней');
    expect(warningsLabel([1])).toBe('за 1 день');
    expect(warningsLabel([7, 0])).toBe('за 7 и в день срока');
    expect(warningsLabel([0])).toBe('в день срока');
    expect(warningsLabel([])).toBe('по умолчанию для типа');
  });
});

describe('«Кто видит» для нового документа (PRD 7.2)', () => {
  const adult = ['personal', 'adults', 'household'] as const;
  const child = { kind: 'member', childMember: true, objectVisibility: null } as const;
  const object = { kind: 'object', childMember: false, objectVisibility: 'adults' } as const;

  it('документ взрослого личный; в режиме «Общее» — «Взрослые»', () => {
    expect(defaultDocumentVisibility('all', NO_OWNER, adult)).toBe('personal');
    expect(defaultDocumentVisibility('personal', NO_OWNER, adult)).toBe('personal');
    expect(defaultDocumentVisibility('shared', NO_OWNER, adult)).toBe('adults');
  });

  it('документ ребёнка — «Взрослые»', () => {
    expect(defaultDocumentVisibility('all', child, adult)).toBe('adults');
    expect(defaultDocumentVisibility('personal', child, adult)).toBe('personal');
  });

  it('документ объекта наследует доступ объекта и другого не предлагает', () => {
    expect(documentVisibilityOptions(adult, object, 'contract')).toEqual(['adults']);
    expect(defaultDocumentVisibility('all', object, ['adults'])).toBe('adults');
  });

  it('удостоверение ребёнка нельзя открыть всей семье', () => {
    expect(documentVisibilityOptions(adult, child, 'birth_certificate')).toEqual([
      'personal',
      'adults',
    ]);
    expect(documentVisibilityOptions(adult, child, 'medical')).toEqual(adult);
  });

  it('ребёнку, который создаёт только личное, остаётся «Только я»', () => {
    expect(defaultDocumentVisibility('shared', NO_OWNER, ['personal'])).toBe('personal');
  });
});
