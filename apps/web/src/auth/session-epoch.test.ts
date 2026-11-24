import { describe, expect, it } from 'vitest';
import { sessionMark, sessionSettled, staleSession, trackSessionChange } from './session-epoch.ts';

describe('поколение сессии (D58)', () => {
  it('ответ запроса, начатого до или во время действия входа, устаревший; после — нет', async () => {
    const before = sessionMark();
    expect(staleSession(before)).toBe(false);
    let finish!: () => void;
    const change = trackSessionChange(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const during = sessionMark();
    expect(staleSession(before)).toBe(true);
    expect(staleSession(during), 'пока действие идёт, устаревший любой ответ').toBe(true);
    let settled = false;
    const waiting = sessionSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await change;
    await waiting;
    expect(settled).toBe(true);
    expect(staleSession(before)).toBe(true);
    expect(staleSession(during)).toBe(true);
    expect(staleSession(sessionMark()), 'запрос после действия — настоящий ответ').toBe(false);
  });

  it('неудачное действие входа тоже завершает ожидание', async () => {
    const before = sessionMark();
    await trackSessionChange(Promise.reject(new Error('Fictional failure'))).catch(() => undefined);
    await sessionSettled();
    expect(staleSession(before)).toBe(true);
    expect(staleSession(sessionMark())).toBe(false);
  });
});
