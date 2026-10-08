import { DeadlineRule } from '@homecrm/shared';
import { expect, it } from 'vitest';
import { warningKinds } from './warnings.ts';

it('правило начала и конца сохраняет два вида в один момент, включая DST', () => {
  const row = {
    date: '2026-11-01',
    startsAt: new Date('2026-11-01T04:00:00Z'),
    endsAt: new Date('2026-11-03T04:59:59.999Z'),
    timeZone: 'America/New_York',
  };
  const rule = DeadlineRule.parse({
    kind: 'window',
    date: row.date,
    durationDays: 1,
    endTime: '23:59',
    warnings: [1, 0],
    endWarnings: [1, 0],
    warningTime: '09:00',
  });
  expect([...warningKinds(rule, row, 'readings')]).toEqual([
    ['2026-10-31T13:00:00.000Z', ['readings_open']],
    ['2026-11-01T14:00:00.000Z', ['readings_open', 'readings_closing']],
    ['2026-11-02T14:00:00.000Z', ['readings_last_day']],
  ]);
});
