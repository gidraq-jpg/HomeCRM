import { describe, expect, it, vi } from 'vitest';
import {
  cancelMotionNavigation,
  changeScreenWithMotion,
  motionDirection,
  navigateWithMotion,
} from './motion.tsx';

describe('направление перехода', () => {
  it('отмена рисунка не отменяет данные и не создаёт ошибку приложения', async () => {
    const update = vi.fn();
    const report = vi.fn();
    const aborted = new DOMException('Skipped', 'AbortError');
    vi.stubGlobal('reportError', report);
    vi.stubGlobal('document', {
      documentElement: { dataset: { design: 'studio' } },
      startViewTransition: (apply: () => void) => {
        apply();
        return {
          skipTransition: vi.fn(),
          ready: Promise.reject(aborted),
          finished: Promise.reject(aborted),
        };
      },
    });
    try {
      changeScreenWithMotion('forward', update);
      await Promise.resolve();
      expect(update).toHaveBeenCalledOnce();
      expect(report).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('карточка и форма добавляют уровень, возврат снимает его', () => {
    expect(motionDirection('/today', '/today/tasks/id')).toBe('forward');
    expect(motionDirection('/home/id', '/home/id/edit')).toBe('forward');
    expect(motionDirection('/today/all', '/today/new')).toBe('forward');
    expect(motionDirection('/today/new', '/today/tasks/id')).toBe('back');
    expect(motionDirection('/today/tasks/id', '/today')).toBe('back');
  });
  it('вкладки и фильтры не двигают экран', () => {
    expect(motionDirection('/today', '/today/all')).toBe(null);
    expect(motionDirection('/today/plan', '/more/shopping')).toBe(null);
    expect(motionDirection('/home', '/documents')).toBe(null);
    expect(motionDirection('/home/id', '/home/id')).toBe(null);
  });
  it('возврат отменяет ещё не применённую навигацию', async () => {
    const updates: (() => void)[] = [];
    const navigate = vi.fn();
    vi.stubGlobal('document', {
      documentElement: { dataset: { design: 'studio' } },
      startViewTransition: (update: () => void) => {
        updates.push(update);
        return { skipTransition: vi.fn(), finished: Promise.resolve() };
      },
    });
    try {
      navigateWithMotion('/today', '/today/tasks/id', navigate);
      cancelMotionNavigation();
      updates[0]?.();
      await Promise.resolve();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
