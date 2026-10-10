import { PersonData } from '@homecrm/shared';
import { expect, it } from 'vitest';
import { mergePerson, normalizePhone, parseVCard, VCardFile } from './vcard.ts';

it('CONT-6: 3.0 QP, переносы, 4.0 URI, ФИО, адрес, организация, дата без года; PHOTO пропускается', () => {
  const rows = parseVCard(
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D0=90=D0=BD=',
      '=D0=BD=D0=B0',
      'TEL:+7 (900) 000-00-01',
      'ADR:;;Вымышленная улица;Город;;;',
      'ORG:Вымышленная;Фирма',
      'NOTE:Первая\\nВторая',
      'BDAY:--02-29',
      'PHOTO;ENCODING=b:broken-photo',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:4.0',
      'N:Тестов;Борис;Тестович;;',
      'TEL;VALUE=uri:tel:+79000000002',
      'BDAY:19900228',
      'EMAIL:test@example.test',
      'END:VCARD',
    ].join('\r\n'),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    title: 'Анна',
    organization: 'Вымышленная · Фирма',
    data: { birthday: '--02-29', address: 'Вымышленная улица, Город', note: 'Первая\nВторая' },
  });
  expect(rows[1]).toMatchObject({
    title: 'Борис Тестович Тестов',
    data: { birthday: '1990-02-28', phones: [{ number: '+79000000002' }] },
  });
});
it('CONT-6: битая карточка, неправильная дата, QP, UTF-8 и лимиты отвергаются целиком', () => {
  for (const content of [
    'BEGIN:VCARD\nVERSION:3.0\nFN:Тест',
    'garbage',
    'BEGIN:VCARD\nVERSION:2.1\nFN:Тест\nEND:VCARD',
    'BEGIN:VCARD\nVERSION:4.0\nFN:Тест\nBDAY:--02-30\nEND:VCARD',
    'BEGIN:VCARD\nVERSION:3.0\nFN;ENCODING=QUOTED-PRINTABLE:=ZZ\nEND:VCARD',
  ])
    expect(() => parseVCard(content)).toThrow('INVALID_VCARD');
  expect(VCardFile.safeParse({ fileName: 'file.txt', content: 'test' }).success).toBe(false);
  expect(VCardFile.safeParse({ fileName: 'file.vcf', content: 'я'.repeat(300000) }).success).toBe(
    false,
  );
});
it('CONT-6: нормализация и объединение дополняют; непустые поля и выключенный флаг сохраняются', () => {
  expect(normalizePhone('8 (900) 000-00-01')).toBe(normalizePhone('+7 900 000 00 01'));
  expect(normalizePhone('abc')).toBe(null);
  expect(
    mergePerson(
      PersonData.parse({
        phones: [{ number: '8 (900) 000-00-01', label: 'Дом' }],
        address: 'Старый адрес',
        note: 'Старая заметка',
      }),
      PersonData.parse({
        phones: [{ number: '+79000000001' }, { number: '+79000000002' }],
        emails: ['test@example.test'],
        address: 'Новый адрес',
        birthday: '--05-10',
        note: 'Импорт',
      }),
    ),
  ).toMatchObject({
    phones: [{ label: 'Дом' }, { number: '+79000000002' }],
    address: 'Старый адрес',
    birthday: '--05-10',
    birthdayEnabled: false,
    note: 'Старая заметка\nИмпорт',
  });
});
