import { expect, it } from 'vitest';
import { contactActions, PersonData } from './contacts.ts';

it('CONT-1/5: даты без года, опасные ссылки и строки, не подходящие для tel', () => {
  expect(PersonData.parse({ birthday: '--02-29' }).birthday).toBe('--02-29');
  expect(PersonData.safeParse({ birthday: '--13-01' }).success).toBe(false);
  expect(PersonData.safeParse({ categories: ['friend', 'friend'] }).success).toBe(false);
  expect(PersonData.safeParse({ messengers: [{ url: 'file:///private' }] }).success).toBe(false);
  expect(
    contactActions(
      PersonData.parse({ phones: [{ number: '123;ext=4' }, { number: '+7 (900) 000-00-00' }] }),
    ).phones,
  ).toEqual([{ label: '', href: 'tel:+79000000000' }]);
});
