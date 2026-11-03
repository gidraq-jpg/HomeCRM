import { type ReactNode, useLayoutEffect, useRef } from 'react';
import {
  motionEasing,
  motionGhost,
  motionSnapshot,
  motionStagger,
  motionTime,
  reducedMotion,
} from './motion.ts';

/** Данные и фокус обновляются сразу; уходящий снимок исключён из доступного дерева. */
export function ContentMotion({ children, version }: { children: ReactNode; version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<{ version: string; node: HTMLElement; height: number } | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const owner = ++generation.current;
    const host = ref.current;
    const live = host?.firstElementChild as HTMLElement | null;
    if (!host || !live) return;
    const old = previous.current;
    previous.current = {
      version,
      node: motionGhost(live),
      height: live.getBoundingClientRect().height,
    };
    if (!old || old.version === version || typeof live.animate !== 'function') return;
    const leaves = (root: HTMLElement) => {
      const rows = [
        ...root.querySelectorAll<HTMLElement>('.row-list > li, [data-motion-key]'),
      ].filter((row) => {
        const ghost = row.closest('[data-motion-ghost]');
        return !ghost || ghost === root;
      });
      return rows.filter((row) => !rows.some((other) => other !== row && row.contains(other)));
    };
    const oldKeys = new Set(leaves(old.node).map((row) => row.dataset.motionKey));
    const currentRows = leaves(live);
    // Группы с прежним заголовком не означают прежние записи.
    if (currentRows.some((row) => row.dataset.motionKey && oldKeys.has(row.dataset.motionKey)))
      return;
    live.getAnimations({ subtree: true }).forEach((animation) => {
      animation.cancel();
    });
    const reduce = reducedMotion();
    const base = motionTime('base');
    const exit = motionTime('fast');
    const easing = motionEasing();
    const ghost = old.node;
    ghost.classList.add('content-motion__old');
    host.style.minHeight = `${old.height}px`;
    host.append(ghost);
    const outgoing = ghost.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: 'translateX(-8%)' },
          ],
      { duration: exit, easing, fill: 'both' },
    );
    const targets = currentRows;
    if (!targets.length) targets.push(live);
    const incoming = targets.map((row, index) =>
      row.animate(
        reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateX(8%)' },
              { opacity: 1, transform: 'translateX(0)' },
            ],
        {
          duration: reduce ? exit : base,
          delay: reduce ? 0 : exit + motionStagger(index, base),
          easing,
          fill: 'both',
        },
      ),
    );
    // Скрываем фон новой группы до окончания выхода, сохраняя её реальные размеры.
    const reveal = targets.includes(live)
      ? null
      : live.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: reduce ? exit : 0,
          delay: reduce ? 0 : exit,
          fill: 'both',
        });
    void outgoing.finished.then(
      () => {
        ghost.remove();
        if (generation.current === owner) host.style.minHeight = '';
      },
      () => {
        ghost.remove();
        if (generation.current === owner) host.style.minHeight = '';
      },
    );
    void Promise.allSettled(incoming.map((animation) => animation.finished)).then(() => {
      incoming.forEach((animation) => {
        animation.cancel();
      });
      reveal?.cancel();
      if (generation.current === owner) {
        previous.current = {
          version,
          node: motionGhost(live),
          height: live.getBoundingClientRect().height,
        };
      }
    });
    return () => {
      // React уже мог заменить дочерний DOM: снимаем уходящий слой, а не новую цель.
      if (ghost.isConnected && ['running', 'paused'].includes(outgoing.playState)) {
        const snapshot = motionSnapshot(ghost);
        snapshot.classList.remove('content-motion__old', 'content-motion');
        snapshot.style.position = '';
        snapshot.style.inset = '';
        previous.current = { version, node: snapshot, height: old.height };
      }
      outgoing.cancel();
      incoming.forEach((animation) => {
        animation.cancel();
      });
      reveal?.cancel();
      ghost.remove();
      host.style.minHeight = '';
    };
  }, [version]);
  return (
    <div ref={ref} className="content-motion" data-content-motion="">
      <div>{children}</div>
    </div>
  );
}
