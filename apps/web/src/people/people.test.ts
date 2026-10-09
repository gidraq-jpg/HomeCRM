import { describe, expect, it } from 'vitest';
import { emptyPersonDraft, personDraft, toggleCategory, toPersonInput } from './form.ts';
import { emptyInteractionDraft, interactionDraft, toInteractionInput } from './interaction-form.ts';
import {
  birthdayLabel,
  categoriesLabel,
  mapHref,
  phoneLines,
  primaryMessage,
  primaryPhone,
} from './labels.ts';
import { NO_ACTIONS } from './schema.ts';

const phone = (number: string, label = '', emergency = false) => ({ number, label, emergency });

describe('форма человека (CONT-1)', () => {
  it('ФИО обязательно, пустые строки пропускаются', () => {
    const empty = toPersonInput(emptyPersonDraft());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.title).toContain('ФИО');

    const draft = {
      ...emptyPersonDraft(['doctor']),
      title: ' Вымышленный Иван ',
      phones: [
        { key: 'a', number: '+7 900 000-00-00', label: 'Рабочий', emergency: false },
        { key: 'b', number: '', label: '', emergency: false },
      ],
      emails: [
        { key: 'e1', value: 'doctor@example.test' },
        { key: 'e2', value: '  ' },
      ],
      messengers: [{ key: 'm', label: 'Telegram', url: 't.me/fictional' }],
    };
    const result = toPersonInput(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Вымышленный Иван');
    expect(result.value.data.phones).toEqual([phone('+7 900 000-00-00', 'Рабочий')]);
    expect(result.value.data.emails).toEqual(['doctor@example.test']);
    expect(result.value.data.messengers).toEqual([
      { label: 'Telegram', url: 'https://t.me/fictional' },
    ]);
    expect(result.value.organizationId).toBeNull();
  });

  it('ошибки привязаны к строкам: номер, почта, ссылка', () => {
    const result = toPersonInput({
      ...emptyPersonDraft(),
      title: 'Вымышленная Анна',
      phones: [{ key: 'p', number: '', label: 'Без номера', emergency: false }],
      emails: [{ key: 'e', value: 'не-почта' }],
      messengers: [{ key: 'm', label: '', url: 'javascript:alert(1)' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.phones.p).toContain('номер');
    expect(result.errors.emails.e).toContain('name@example.ru');
    expect(result.errors.messengers.m).toContain('http');
  });

  it('день рождения с годом и без года', () => {
    const withYear = toPersonInput({
      ...emptyPersonDraft(),
      title: 'Вымышленный Пётр',
      birthday: '1990-03-14',
    });
    expect(withYear.ok && withYear.value.data.birthday).toBe('1990-03-14');

    const noYear = toPersonInput({
      ...emptyPersonDraft(),
      title: 'Вымышленный Пётр',
      birthday: '2000-02-29',
      birthdayNoYear: true,
    });
    expect(noYear.ok && noYear.value.data.birthday).toBe('--02-29');

    const back = personDraft({
      title: 'Вымышленный Пётр',
      organizationId: null,
      data: {
        categories: [],
        phones: [],
        emails: [],
        messengers: [],
        address: '',
        birthday: '--02-29',
        note: '',
      },
    });
    expect(back.birthdayNoYear).toBe(true);
    expect(back.birthday).toBe('2000-02-29');
  });

  it('категории идут в порядке справочника', () => {
    expect(toggleCategory(['doctor'], 'family', true)).toEqual(['family', 'doctor']);
    expect(toggleCategory(['family', 'doctor'], 'family', false)).toEqual(['doctor']);
    expect(categoriesLabel(['craftsperson', 'neighbor'])).toBe('Мастер, Сосед');
  });

  it('день рождения словами', () => {
    expect(birthdayLabel(null)).toBe('—');
    expect(birthdayLabel('--10-05')).toBe('5 окт.');
    expect(birthdayLabel('1990-03-14')).toBe('14 мар. 1990');
  });
});

describe('взаимодействие (CONT-4)', () => {
  const today = '2026-10-09';

  it('сумма в рублях с запятой уходит целыми копейками', () => {
    const result = toInteractionInput({
      ...emptyInteractionDraft(today),
      kind: 'work',
      text: ' Заменили кран ',
      amount: '1 840,50',
      callAgain: 'yes',
      objectId: 'object-1',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'work',
        occurredOn: today,
        text: 'Заменили кран',
        amountCents: 184050,
        callAgain: true,
        objectId: 'object-1',
      },
    });
  });

  it('сумма необязательна, «звать снова» может быть не отмечено', () => {
    const result = toInteractionInput({ ...emptyInteractionDraft(today), text: 'Звонил' });
    expect(result.ok && result.value.amountCents).toBeNull();
    expect(result.ok && result.value.callAgain).toBeNull();
    expect(result.ok && result.value.objectId).toBeNull();
  });

  it('пустой текст, дробь из трёх знаков и минус не сохраняются', () => {
    const empty = toInteractionInput(emptyInteractionDraft(today));
    expect(empty.ok).toBe(false);
    const bad = toInteractionInput({
      ...emptyInteractionDraft(today),
      text: 'Работа',
      amount: '10,555',
    });
    expect(bad.ok === false && bad.errors.amount).toBeTruthy();
    const minus = toInteractionInput({
      ...emptyInteractionDraft(today),
      text: 'Работа',
      amount: '-5',
    });
    expect(minus.ok === false && minus.errors.amount).toBeTruthy();
  });

  it('черновик из записи возвращает ту же сумму и выбор', () => {
    const draft = interactionDraft({
      id: '1',
      parentId: 'c',
      spaceId: 's',
      spaceKind: 'personal',
      audience: null,
      authorId: 'a',
      assigneeId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      kind: 'visit',
      occurredOn: today,
      text: 'Приходил',
      amountCents: 350000,
      callAgain: false,
      objectId: null,
      object: null,
    });
    expect(draft).toMatchObject({ kind: 'visit', amount: '3500', callAgain: 'no', objectId: '' });
  });
});

describe('быстрые действия (CONT-5)', () => {
  const actions = {
    ...NO_ACTIONS,
    phones: [
      { label: 'Рабочий', href: 'tel:+79000000000' },
      { label: 'Аварийная', href: 'tel:+78005553535' },
    ],
    emails: [{ href: 'mailto:doctor@example.test' }],
    messengers: [{ label: 'Telegram', href: 'https://t.me/fictional' }],
    mapAddress: 'Вымышленная улица, 1',
  };

  it('ссылки tel: сопоставляются с номерами, непригодный номер остаётся без ссылки', () => {
    const lines = phoneLines(
      [
        phone('+7 (900) 000-00-00', 'Рабочий'),
        phone('доб. 5', 'Внутренний'),
        phone('+7 800 555-35-35', 'Аварийная', true),
      ],
      actions,
    );
    expect(lines.map((line) => line.href)).toEqual(['tel:+79000000000', null, 'tel:+78005553535']);
  });

  it('звонок — на аварийный номер, если он есть; «Написать» — мессенджер важнее почты', () => {
    const lines = phoneLines(
      [phone('+79000000000', 'Рабочий'), phone('+78005553535', 'Аварийная', true)],
      actions,
    );
    expect(primaryPhone(lines)?.label).toBe('Аварийная');
    expect(primaryMessage(actions)).toEqual({ href: 'https://t.me/fictional', label: 'Telegram' });
    expect(primaryMessage({ ...actions, messengers: [] })?.href).toBe('mailto:doctor@example.test');
    expect(primaryMessage(NO_ACTIONS)).toBeNull();
  });

  it('адрес для карты кодируется', () => {
    expect(mapHref('ул. Вымышленная, 1')).toBe(
      `https://yandex.ru/maps/?text=${encodeURIComponent('ул. Вымышленная, 1')}`,
    );
  });
});
