import { PushEndpoint } from '@homecrm/shared';
import { expect, it } from 'vitest';
import { budgetDate, quietUntil, retryAt } from './policy.ts';

it('тихие часы пересекают полночь и кончаются в 08:00 дома', () => {
  for (const instant of ['2026-10-07T18:00:00Z', '2026-10-08T01:00:00Z'])
    expect(
      quietUntil(new Date(instant), 'Asia/Yekaterinburg', '22:00', '08:00')?.toISOString(),
    ).toBe('2026-10-08T03:00:00.000Z');
  expect(
    quietUntil(new Date('2026-10-08T03:00:00Z'), 'Asia/Yekaterinburg', '22:00', '08:00'),
  ).toBeNull();
  expect(quietUntil(new Date(), 'UTC', '08:00', '08:00')).toBeNull();
  expect(quietUntil(new Date('2026-10-08T11:00:00Z'), 'UTC', '10:00', '14:00')?.toISOString()).toBe(
    '2026-10-08T14:00:00.000Z',
  );
});
it('DST и смена календарного дня не привязаны к поясу сервера', () => {
  expect(
    quietUntil(new Date('2026-03-28T22:00:00Z'), 'Europe/Berlin', '22:00', '08:00')?.toISOString(),
  ).toBe('2026-03-29T06:00:00.000Z');
  expect(
    quietUntil(new Date('2026-10-24T21:00:00Z'), 'Europe/Berlin', '22:00', '08:00')?.toISOString(),
  ).toBe('2026-10-25T07:00:00.000Z');
  expect(budgetDate(new Date('2026-10-07T21:00:00Z'), 'Asia/Yekaterinburg')).toBe('2026-10-08');
  expect(+retryAt(new Date(0), 2)).toBe(60_000);
  expect(+retryAt(new Date(0), 100)).toBe(3_600_000);
});
it('адрес push не позволяет worker обратиться к внутренней сети', () => {
  for (const url of [
    'https://127.0.0.1/a',
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com.evil.invalid/a',
    'https://user@fcm.googleapis.com/a',
    'https://fcm.googleapis.com:443/a',
  ])
    expect(PushEndpoint.safeParse(url).success).toBe(false);
  expect(PushEndpoint.safeParse('https://fcm.googleapis.com/fcm/send/fictional').success).toBe(
    true,
  );
});
