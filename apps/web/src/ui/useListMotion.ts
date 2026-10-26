import { type RefObject, useLayoutEffect, useRef } from 'react';
import { motionTime, reducedMotion } from './motion.ts';

interface Snapshot {
  node: HTMLElement;
  source: HTMLElement;
  height: number;
  next: string | undefined;
}

/** Удалённая копия только рисуется: данные, фокус и доступное дерево обновляются сразу. */
export function useListMotion(
  ref: RefObject<HTMLElement | null>,
  version: string,
  kind: 'list' | 'toast' = 'list',
) {
  const previous = useRef(new Map<string, Snapshot>());
  const initialized = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: снимок меняется вместе с составом и состояниями строк
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || document.documentElement.dataset.design !== 'studio') return;
    const rows = [...list.children].filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && !node.hasAttribute('data-motion-ghost'),
    );
    const next = new Map<string, Snapshot>();
    const cleanup: (() => void)[] = [];
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out');
    const reduce = reducedMotion();
    const duration = motionTime(reduce ? 'fast' : 'base');
    for (const [index, row] of rows.entries()) {
      const key = row.dataset.motionKey;
      if (!key) continue;
      const height = row.getBoundingClientRect().height;
      next.set(key, {
        node: row.cloneNode(true) as HTMLElement,
        source: row,
        height,
        next: rows[index + 1]?.dataset.motionKey,
      });
      if ((initialized.current || kind === 'toast') && !previous.current.has(key)) {
        const animation = row.animate(
          reduce
            ? [{ opacity: 0 }, { opacity: 1 }]
            : kind === 'toast'
              ? [
                  { transform: 'translateY(16px)', opacity: 0 },
                  { transform: 'translateY(0)', opacity: 1 },
                ]
              : [
                  { height: '0px', opacity: 0 },
                  { height: `${height}px`, opacity: 1 },
                ],
          { duration, easing },
        );
        cleanup.push(() => animation.cancel());
      }
    }
    for (const [key, snapshot] of previous.current) {
      if (next.has(key)) continue;
      const ghost = snapshot.node;
      if (
        snapshot.source.dataset.motionCompleted === 'true' ||
        snapshot.source.querySelector('[data-motion-completed="true"]')
      )
        ghost.dataset.motionCompleted = 'true';
      ghost.dataset.motionGhost = '';
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('[id]').forEach((node) => {
        node.removeAttribute('id');
      });
      ghost.removeAttribute('id');
      ghost.style.overflow = 'hidden';
      ghost.style.minHeight = '0';
      const following = rows.find((row) => row.dataset.motionKey === snapshot.next);
      list.insertBefore(ghost, following ?? null);
      const completed = ghost.dataset.motionCompleted === 'true';
      if (completed) {
        ghost.querySelectorAll('.plan-circle').forEach((circle) => {
          circle.classList.add('plan-circle--done');
          if (!circle.querySelector('svg'))
            circle.innerHTML =
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="4 12 9 17 20 6" /></svg>';
        });
      }
      const animation = ghost.animate(
        reduce
          ? [{ opacity: 1 }, { opacity: 0 }]
          : kind === 'toast'
            ? [
                { transform: 'translateY(0)', opacity: 1 },
                { transform: 'translateY(16px)', opacity: 0 },
              ]
            : [
                { height: `${snapshot.height}px`, opacity: 1 },
                { height: '0px', opacity: 0 },
              ],
        {
          duration,
          easing,
          delay: !reduce && completed ? motionTime('base') * 2 : 0,
          fill: 'forwards',
        },
      );
      void animation.finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
      cleanup.push(() => {
        animation.cancel();
        ghost.remove();
      });
    }
    previous.current = next;
    initialized.current = true;
    return () => {
      for (const clean of cleanup) clean();
    };
  }, [ref, version, kind]);
}
