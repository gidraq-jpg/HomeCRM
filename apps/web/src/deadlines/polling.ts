// Опрос радара, пока сервер пересчитывает сроки (`recalculating`). Опрос ограничен: интервал
// растёт, а после примерно минуты клиент останавливается и просит обновить позже (PRD 14).

/** Паузы между запросами: 2, 4, 8 и 16 секунд, потом 16 секунд до предела. */
const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 16_000;
/** Всего шесть запросов: 2 + 4 + 8 + 16 + 16 + 16 секунд, около минуты. */
export const MAX_POLLS = 6;

/** Пауза перед запросом с номером `attempt` (с нуля); `null` — предел исчерпан. */
export function radarPollDelay(attempt: number): number | null {
  if (attempt >= MAX_POLLS) return null;
  return Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

export interface PollingDeps {
  /** Перечитать радар. Ошибки сети не прерывают опрос: следующая попытка пойдёт по расписанию. */
  refetch: () => Promise<unknown>;
  /** Предел исчерпан, а пересчёт всё ещё идёт. */
  onGiveUp: () => void;
  isHidden: () => boolean;
  /** Подписка на возврат вкладки на экран; возвращает отписку. */
  onVisible: (listener: () => void) => () => void;
}

/**
 * Запускает опрос и возвращает функцию остановки. На скрытой вкладке запросов нет: опрос
 * ждёт возврата на экран, и пауза не засчитывается в предел.
 */
export function startRadarPolling(deps: PollingDeps): () => void {
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  function schedule() {
    const delay = radarPollDelay(attempt);
    if (delay === null) {
      deps.onGiveUp();
      return;
    }
    timer = setTimeout(tick, delay);
  }

  function tick() {
    if (stopped) return;
    if (deps.isHidden()) {
      unsubscribe?.();
      unsubscribe = deps.onVisible(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        tick();
      });
      return;
    }
    attempt += 1;
    deps
      .refetch()
      .catch(() => undefined)
      .then(() => {
        if (!stopped) schedule();
      });
  }

  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
  };
}
