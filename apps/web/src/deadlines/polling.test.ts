import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_POLLS, radarPollDelay, startRadarPolling } from './polling.ts';

describe('пауза между запросами радара', () => {
  it('растёт вдвое до 16 секунд, всего около минуты', () => {
    const delays = Array.from({ length: MAX_POLLS }, (_, attempt) => radarPollDelay(attempt));
    expect(delays).toEqual([2000, 4000, 8000, 16000, 16000, 16000]);
    expect(delays.reduce<number>((sum, delay) => sum + (delay ?? 0), 0)).toBeLessThanOrEqual(
      62_000,
    );
    expect(radarPollDelay(MAX_POLLS)).toBeNull();
  });
});

describe('опрос радара при пересчёте', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(hidden = false) {
    const state = { hidden, wake: null as null | (() => void) };
    const refetch = vi.fn(() => Promise.resolve());
    const onGiveUp = vi.fn();
    const stop = startRadarPolling({
      refetch,
      onGiveUp,
      isHidden: () => state.hidden,
      onVisible: (listener) => {
        state.wake = listener;
        return () => {
          state.wake = null;
        };
      },
    });
    return { state, refetch, onGiveUp, stop };
  }

  it('останавливается после предела и сообщает об этом, а не опрашивает бесконечно', async () => {
    const { refetch, onGiveUp } = setup();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(MAX_POLLS);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('интервал растёт: за первые 7 секунд только два запроса', async () => {
    const { refetch } = setup();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('на скрытой вкладке запросов нет, на возврате опрос продолжается', async () => {
    const { state, refetch, onGiveUp } = setup(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refetch).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
    state.hidden = false;
    state.wake?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('ошибка запроса не прерывает опрос; остановка гасит таймеры', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    const stop = startRadarPolling({
      refetch: failing,
      onGiveUp: vi.fn(),
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    await vi.advanceTimersByTimeAsync(2_000 + 4_000);
    expect(failing).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
