import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { motionTime, reducedMotion } from '../ui/motion.ts';
import {
  cardOrigins,
  clearNavigationPositions,
  originLink,
  positions,
  requestedPosition,
  requestPosition,
} from './navigation-position.ts';

/** История возвращает место чтения; новое открытие раздела начинается сверху. */
export function useNavigationPosition() {
  const location = useLocation();
  const type = useNavigationType();
  const previousPath = useRef<string>(undefined);
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
      clearNavigationPositions();
    };
  }, []);
  useLayoutEffect(() => {
    const key = location.key;
    const restoreKey = requestedPosition ?? (type === 'POP' ? key : undefined);
    requestPosition(undefined);
    const target = restoreKey
      ? (positions.get(restoreKey) ?? 0)
      : previousPath.current === location.pathname
        ? window.scrollY
        : 0;
    previousPath.current = location.pathname;
    let restoring = target > 0;
    let highlight: Animation | undefined;
    let frame = 0;
    let stableFrames = 0;
    let lastHeight = 0;
    const origin = [...cardOrigins.values()].find((entry) => entry.parentKey === restoreKey);
    const restore = () => {
      if (!restoring) return;
      if (Math.abs(window.scrollY - target) > 0.5)
        window.scrollTo({ top: target, behavior: 'instant' });
      const link = origin && originLink(origin);
      if (window.scrollY >= target - 1) {
        const height = document.documentElement.scrollHeight;
        const moving = document
          .getAnimations()
          .some(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getTiming().iterations !== Infinity,
          );
        stableFrames = height === lastHeight && !moving ? stableFrames + 1 : 0;
        lastHeight = height;
        // После снимка и смены высоты шапки браузер может ещё поправить scroll anchoring.
        if (stableFrames < 3) {
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              restore();
            });
          return;
        }
        restoring = false;
        if (link && !reducedMotion()) {
          link.dataset.navigationReturn = '';
          highlight = link.animate([{ opacity: 0.55 }, { opacity: 1 }], {
            duration: motionTime('base'),
          });
          void highlight.finished.then(
            () => delete link.dataset.navigationReturn,
            () => delete link.dataset.navigationReturn,
          );
        }
      }
    };
    const record = () => {
      if (!restoring) positions.set(key, window.scrollY);
    };
    const interrupt = () => {
      restoring = false;
      cancelAnimationFrame(frame);
      record();
    };
    window.scrollTo({ top: target, behavior: 'instant' });
    restore();
    const main = document.querySelector('.main');
    const observer = new ResizeObserver(restore);
    if (main) observer.observe(main);
    // Загрузка может менять содержимое, сохраняя минимальную высоту светлой панели.
    const mutations = new MutationObserver(restore);
    if (main) mutations.observe(main, { childList: true, subtree: true });
    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt, { passive: true });
    window.addEventListener('keydown', interrupt);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      highlight?.cancel();
      window.removeEventListener('scroll', record);
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('pointerdown', interrupt);
      window.removeEventListener('keydown', interrupt);
    };
  }, [location.key, location.pathname, type]);
}
