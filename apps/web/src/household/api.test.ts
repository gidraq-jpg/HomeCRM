import { expect, it } from 'vitest';
import { Member } from './api.ts';

it('скрытый профиль бывшего участника не ломает разбор состава дома', () => {
  const former = Member.parse({
    accountId: 'fictional-boris',
    displayName: 'Борис',
    role: 'adult',
    isAdult: true,
    formerMember: true,
    leftAt: '2026-10-10T00:00:00Z',
    photoFileId: null,
    birthDate: null,
    birthdayEnabled: null,
    phone: null,
  });
  expect(former).toMatchObject({
    accountId: 'fictional-boris',
    formerMember: true,
    birthdayEnabled: false,
  });
});
