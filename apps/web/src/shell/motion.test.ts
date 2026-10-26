import { describe, expect, it, vi } from 'vitest';
import {
  cancelMotionNavigation,
  changeScreenWithMotion,
  motionDirection,
  navigateHistoryWithMotion,
  navigateWithMotion,
} from './motion.tsx';

describe('направление перехода', () => {
  it('кнопка истории снимает старый экран до navigate и ждёт popstate', async () => {
    const root = { dataset: { design: 'studio' } as Record<string, string> };
    let update: (() => void | Promise<void>) | undefined;
    vi.stubGlobal('window', { history: { state: { idx: 1 } } });
    vi.stubGlobal('document', {
      documentElement: root,
      startViewTransition: (callback: typeof update) => {
        update = callback;
        return { skipTransition: vi.fn(), finished: new Promise(() => {}) };
      },
    });
    const navigate = vi.fn();
    try {
      navigateHistoryWithMotion(-1, navigate);
      expect(navigate).not.toHaveBeenCalled();
      expect(root.dataset.motionDirection).toBe('back');
      const committed = vi.fn();
      const done = update?.();
      void Promise.resolve(done).then(committed);
      expect(navigate).toHaveBeenCalledWith(-1);
      await Promise.resolve();
      expect(committed).not.toHaveBeenCalled();
      cancelMotionNavigation();
      await done;
      expect(committed).toHaveBeenCalledOnce();
    } finally {
      cancelMotionNavigation();
      vi.unstubAllGlobals();
    }
  });
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
