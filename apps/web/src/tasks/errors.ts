import { ApiError, errorMessage } from '../auth/api.ts';
import { localMessage } from '../offline/identity.ts';
import { TaskError } from './api.ts';
export function taskError(error: unknown): string {
  const local = localMessage(error);
  if (local) return local;
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (
    error instanceof TaskError &&
    error.code === 'ASSIGNEE_NOT_VISIBLE' &&
    error.suggestedPlacement === null
  )
    return 'Участник не видит дело, и сервер не предлагает допустимого расширения доступа. Выберите другого исполнителя. Введённое сохранено.';
  const messages: Record<string, string> = {
    UNDO_CONFLICT:
      'Отмена невозможна: семь секунд истекли, событие сменилось или следующее дело уже изменено. Данные обновлены.',
    INVALID_QUICKLINE:
      'Название должно содержать от 1 до 200 символов; для времени нужна дата. Строка сохранена.',
    ASSIGNEE_NOT_VISIBLE: 'Участник не видит дело. Передача требует вашего подтверждения доступа.',
    HOUSE_REQUIRED: 'Для дат нужен дом и его часовой пояс. Выберите дом, введённое сохранено.',
    HOUSE_ALREADY_BOUND:
      'Дом уже привязан к делу. Обновите карточку; менять его часовой пояс через дело нельзя.',
    STALE_VERSION:
      'Дело изменили на другом устройстве. Черновик сохранён. Обновите карточку и сравните изменения.',
    NOT_CURRENT_INSTANCE:
      'Это прежний экземпляр серии. Обновите данные и откройте текущий из «Плана».',
    UNDO_EXPIRED:
      'Семь секунд для отмены истекли. Данные обновлены; дело можно возобновить отдельно.',
    COMPLETION_CHANGED: 'Событие выполнения сменилось. Данные обновлены.',
    NEXT_TASK_CHANGED: 'Следующее дело уже изменено. Отмена невозможна; данные обновлены.',
    SERIES_CHANGED: 'Серия изменилась: восстановление создаст два текущих дела. Обновите данные.',
    NOT_SERIES_TRASH: 'Эта запись удалена отдельно. Верните только это дело.',
    EDIT_SOURCE: 'Ответственный задаётся в записи-источнике. Откройте её.',
    IDEMPOTENCY_CONFLICT: 'Запрос с этим ключом уже имеет другой результат. Обновите данные.',
  };
  if (error.status === 404) return 'Дело недоступно или больше не существует.';
  return (
    messages[error.code] ??
    (error.status === 409
      ? 'Данные изменились. Черновик сохранён; обновите карточку перед повтором.'
      : errorMessage(error))
  );
}
