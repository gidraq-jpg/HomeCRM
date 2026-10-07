import { useSyncExternalStore } from 'react';

// «В корзину» с отменой за 7 секунд. У срока нет самостоятельного восстановления (ADR-0028),
// поэтому удаление откладывается: срок сразу пропадает с экранов, а на сервер уходит только
// когда время отмены вышло. Закрытие вкладки за эти секунды оставляет срок на месте — это
// безопаснее, чем потерять его.

export const UNDO_MS = 7000;

const timers = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function publish() {
  snapshot = new Set(timers.keys());
  for (const listener of listeners) listener();
}

/** Поставить срок на удаление через `UNDO_MS`; `commit` выполняется, если не отменили. */
export function scheduleTrash(id: string, commit: () => Promise<void>, onFail: () => void) {
  if (timers.has(id)) return;
  timers.set(
    id,
    window.setTimeout(() => {
      commit()
        .catch(onFail)
        .finally(() => {
          timers.delete(id);
          publish();
        });
    }, UNDO_MS),
  );
  publish();
}

/** Отменить отложенное удаление: срок возвращается на экраны. */
export function cancelTrash(id: string) {
  const timer = timers.get(id);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timers.delete(id);
  publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Сроки, которые уже убраны с экрана, но ещё не удалены на сервере. */
export function usePendingTrash(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
