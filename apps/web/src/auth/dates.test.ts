import { describe, expect, it } from 'vitest';
import { formatDay, formatMoment } from './dates.ts';

const now = new Date('2026-10-06T10:00:00Z');

describe('даты по PRD 13', () => {
  it('в часовом поясе дома, без года в текущем году', () => {
    // 03:52 UTC — это 08:52 в Екатеринбурге (UTC+5).
    expect(formatMoment('2026-10-05T03:52:00Z', 'Asia/Yekaterinburg', now)).toBe('5 окт., 08:52');
    expect(formatMoment('2026-10-05T03:52:00Z', 'UTC', now)).toBe('5 окт., 03:52');
  });

  it('день переходит через полночь вместе с поясом', () => {
    expect(formatDay('2026-10-05T20:30:00Z', 'Asia/Yekaterinburg', now)).toBe('6 окт.');
    expect(formatDay('2026-10-05T20:30:00Z', 'UTC', now)).toBe('5 окт.');
  });

  it('год — только если он не текущий', () => {
    expect(formatMoment('2025-12-31T21:15:00Z', 'UTC', now)).toBe('31 дек. 2025, 21:15');
    // Новый год по дому наступил раньше, чем по UTC.
    expect(
      formatDay('2025-12-31T21:15:00Z', 'Asia/Yekaterinburg', new Date('2026-01-01T00:00:00Z')),
    ).toBe('1 янв.');
  });
});
