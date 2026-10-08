import { describe, expect, it } from 'vitest';
import {
  addPhone,
  emptyOrganizationDraft,
  organizationDraft,
  removePhone,
  toOrganizationInput,
  updatePhone,
} from './form.ts';

describe('форма организации', () => {
  it('обязательно только название', () => {
    const empty = toOrganizationInput(emptyOrganizationDraft());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.title).toContain('Введите название');

    const named = toOrganizationInput({ ...emptyOrganizationDraft(), title: '  Вымышленная УК ' });
    expect(named).toEqual({
      ok: true,
      title: 'Вымышленная УК',
      data: {
        organizationType: 'other',
        phones: [],
        website: null,
        address: '',
        openingHours: '',
        note: '',
      },
    });
  });

  it('телефон с подписью и меткой «аварийный»; пустые строки пропускаются', () => {
    let draft = {
      ...emptyOrganizationDraft(),
      title: 'УК',
      organizationType: 'management' as const,
    };
    draft = { ...draft, phones: addPhone(addPhone(addPhone(draft.phones))) };
    const [first, second] = draft.phones;
    if (!first || !second) throw new Error('нет строк телефонов');
    draft = {
      ...draft,
      phones: updatePhone(
        updatePhone(draft.phones, first.key, {
          number: '+7 000 123-45-67',
          label: 'Аварийная служба',
          emergency: true,
        }),
        second.key,
        { number: '8 (000) 555-00-11' },
      ),
    };
    const result = toOrganizationInput(draft);
    expect(result.ok && result.data.phones).toEqual([
      { number: '+7 000 123-45-67', label: 'Аварийная служба', emergency: true },
      { number: '8 (000) 555-00-11', label: '', emergency: false },
    ]);
  });

  it('подпись без номера и неверный сайт названы у своего поля', () => {
    let draft = { ...emptyOrganizationDraft(), title: 'УК', website: 'не сайт' };
    draft = { ...draft, phones: addPhone(draft.phones) };
    const row = draft.phones[0];
    if (!row) throw new Error('нет строки телефона');
    draft = { ...draft, phones: updatePhone(draft.phones, row.key, { label: 'Диспетчер' }) };
    const result = toOrganizationInput(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.website).toContain('https://');
      expect(result.errors.phones[row.key]).toContain('номер');
    }
  });

  it('сайт без схемы получает https://, форма правки начинается с сохранённого', () => {
    const draft = organizationDraft('УК', {
      organizationType: 'management',
      phones: [{ number: '1', label: '', emergency: false }],
      website: 'https://uk.example',
      address: 'Адрес',
      openingHours: 'Пн–Пт',
      note: '',
    });
    expect(draft.phones).toHaveLength(1);
    expect(draft.website).toBe('https://uk.example');
    const changed = toOrganizationInput({ ...draft, website: 'uk.example' });
    expect(changed.ok && changed.data.website).toBe('https://uk.example');
  });

  it('телефон удаляется по ключу, телефонов не больше двадцати', () => {
    let phones = addPhone([]);
    const key = phones[0]?.key ?? '';
    expect(removePhone(phones, key)).toEqual([]);
    for (let i = 0; i < 30; i += 1) phones = addPhone(phones);
    expect(phones).toHaveLength(20);
  });
});
