import { DocumentData } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import {
  type DocumentDraft,
  draftFrom,
  EMPTY_DOCUMENT,
  parseTags,
  parseWarnings,
  renewalDraft,
  toDocument,
} from './form.ts';

const draft = (patch: Partial<DocumentDraft>): DocumentDraft => ({ ...EMPTY_DOCUMENT, ...patch });

describe('документ: теги и предупреждения', () => {
  it('теги без пустых и повторов, регистр сохраняется', () => {
    expect(parseTags(' паспорт, Поездка ,, паспорт;ПОЕЗДКА\nсрочно')).toEqual([
      'паспорт',
      'Поездка',
      'срочно',
    ]);
    expect(parseTags('')).toEqual([]);
  });

  it('предупреждения — целые дни 0…365 по убыванию, без повторов', () => {
    expect(parseWarnings('30, 180 90;30')).toEqual([180, 90, 30]);
    expect(parseWarnings('')).toEqual([]);
    expect(parseWarnings('0')).toEqual([0]);
    expect(parseWarnings('366')).toBeNull();
    expect(parseWarnings('10,5')).toEqual([10, 5]);
    expect(parseWarnings('десять')).toBeNull();
    expect(parseWarnings('1.5')).toBeNull();
  });
});

describe('документ: черновик → данные для API', () => {
  it('название обязательно', () => {
    const result = toDocument(draft({ title: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toContain('Введите название');
  });

  it('собирает реквизиты, обрезает пробелы и не отправляет пустые предупреждения', () => {
    const result = toDocument(
      draft({
        title: ' Загранпаспорт Веры ',
        type: 'international_passport',
        series: ' 75 ',
        number: ' 1234567 ',
        issuedBy: ' Вымышленное ведомство ',
        issuedOn: '2020-01-10',
        expiresOn: '2030-01-09',
        tags: 'поездка, срочно',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('Загранпаспорт Веры');
      expect(result.data).toMatchObject({
        type: 'international_passport',
        series: '75',
        number: '1234567',
        issuedBy: 'Вымышленное ведомство',
        issuedOn: '2020-01-10',
        expiresOn: '2030-01-09',
        indefinite: false,
        tags: ['поездка', 'срочно'],
      });
      expect(result.data.warnings).toBeUndefined();
    }
  });

  it('свои предупреждения уходят массивом дней', () => {
    const result = toDocument(draft({ title: 'Полис', warnings: '14, 60' }));
    expect(result.ok && result.data.warnings).toEqual([60, 14]);
  });

  it('бессрочный документ не имеет даты окончания', () => {
    const result = toDocument(draft({ title: 'СНИЛС', indefinite: true, expiresOn: '2030-01-01' }));
    expect(result.ok && result.data.expiresOn).toBeNull();
    expect(result.ok && result.data.indefinite).toBe(true);
  });

  it('срок раньше выдачи — ошибка у поля срока', () => {
    const result = toDocument(
      draft({ title: 'Полис', issuedOn: '2026-05-01', expiresOn: '2026-04-30' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.expiresOn).toContain('раньше даты выдачи');
  });

  it('несуществующая дата не проходит', () => {
    const result = toDocument(draft({ title: 'Полис', expiresOn: '2026-02-31' }));
    expect(result.ok).toBe(false);
  });

  it('плохие дни предупреждений показывают ошибку у своего поля', () => {
    const result = toDocument(draft({ title: 'Полис', warnings: '400' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.warnings).toContain('от 0 до 365');
  });
});

describe('документ: правка и продление', () => {
  const data = DocumentData.parse({
    type: 'osago',
    series: 'XXX',
    number: '0000',
    issuedBy: 'Вымышленная страховая',
    issuedOn: '2025-10-10',
    expiresOn: '2026-10-09',
    tags: ['авто'],
    warnings: [30, 7],
  });

  it('черновик правки повторяет карточку', () => {
    expect(draftFrom('ОСАГО', data)).toMatchObject({
      title: 'ОСАГО',
      type: 'osago',
      issuedOn: '2025-10-10',
      expiresOn: '2026-10-09',
      tags: 'авто',
      warnings: '30, 7',
    });
  });

  it('при продлении реквизиты переносятся, а даты вводятся заново', () => {
    const renewal = renewalDraft('ОСАГО', data);
    expect(renewal.number).toBe('0000');
    expect(renewal.issuedOn).toBe('');
    expect(renewal.expiresOn).toBe('');
  });
});
