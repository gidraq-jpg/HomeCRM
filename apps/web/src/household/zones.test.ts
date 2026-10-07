import { describe, expect, it } from 'vitest';
import { zoneLabel, zoneOffset } from './zones.ts';

const NOW = new Date('2026-10-07T09:00:00Z');

describe('часовой пояс дома (DEAD-6)', () => {
  it('смещение от UTC: «UTC+3», «UTC+5», «UTC»', () => {
    expect(zoneOffset('Europe/Moscow', NOW)).toBe('UTC+3');
    expect(zoneOffset('Asia/Yekaterinburg', NOW)).toBe('UTC+5');
    expect(zoneOffset('UTC', NOW)).toBe('UTC');
  });

  it('подпись — город и смещение; неизвестный пояс показывается как есть', () => {
    expect(zoneLabel('Asia/Yekaterinburg', NOW)).toBe('Екатеринбург (UTC+5)');
    expect(zoneLabel('Asia/Dubai', NOW)).toBe('Asia/Dubai (UTC+4)');
  });
});
