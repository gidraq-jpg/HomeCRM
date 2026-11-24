/**
 * Поколение сессии этой вкладки (D58, AUTH-6). Действия входа на сервере могут заменить сессию:
 * включение и подтверждение второго фактора, его выключение, смена пароля с завершением остальных
 * сессий. Старая сессия удаляется раньше, чем браузер получает новую cookie, поэтому запрос,
 * ушедший со старой cookie, получает 401, хотя участник по-прежнему вошёл.
 *
 * Такой ответ «устаревший»: запрос начался до завершения действия входа или во время него.
 * По нему нельзя выходить — сначала дожидаемся действия и перепроверяем сессию. Настоящий 401
 * (сессию завершили с другого устройства, она истекла) приходит без действия входа и ведёт на вход.
 */
let generation = 0;
const pending = new Set<Promise<unknown>>();

/** Отметка в начале запроса: с ней потом сравнивается ответ 401. */
export function sessionMark(): number {
  return generation;
}

/** Ответ запроса с этой отметкой мог прийти со старой сессией. */
export function staleSession(mark: number): boolean {
  return mark !== generation || pending.size > 0;
}

/** Действие входа: пока оно идёт и после него ответы 401 прежних запросов перепроверяются. */
export function trackSessionChange<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  generation += 1;
  const settle = () => {
    pending.delete(work);
    generation += 1;
  };
  work.then(settle, settle);
  return work;
}

/** Ждёт, пока завершатся все действия входа, начатые к этому моменту и во время ожидания. */
export async function sessionSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
