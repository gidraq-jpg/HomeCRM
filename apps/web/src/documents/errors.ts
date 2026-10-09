import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API документов (ADR-0035). Технические сообщения сервера не показываются.
// Каждое объяснение говорит, что делать дальше; названий, серий и номеров в них нет.

export type DocumentAction =
  | 'load'
  | 'create'
  | 'save'
  | 'renew'
  | 'trash'
  | 'restore'
  | 'share'
  | 'assignee';

export function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'STALE_VERSION';
}

export function documentErrorMessage(error: unknown, action: DocumentAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 404) {
    return action === 'create'
      ? 'Владельца или объект документа больше нет, или они стали вам недоступны. Выберите другого владельца.'
      : 'Документа больше нет, или он стал вам недоступен. Вернитесь в «Документы» и обновите список.';
  }
  if (status === 403) {
    switch (action) {
      case 'create':
        return 'Создать такой документ вам нельзя. Выберите «Только я» или другого владельца.';
      case 'trash':
        return 'Убрать общий документ в корзину могут только взрослые.';
      case 'restore':
        return 'Вернуть общий документ из корзины может его автор-взрослый или администратор.';
      case 'share':
        return 'Поделиться можно только своим личным документом.';
      case 'assignee':
        return 'Сменить ответственного не удалось: этот участник не увидит документ.';
      default:
        return 'Это действие вам недоступно. Обновите страницу: возможно, права изменились.';
    }
  }
  if (status === 409) {
    if (isStaleVersion(error)) {
      return 'Документ изменили, пока вы его правили. Обновите страницу и повторите.';
    }
    if (code === 'DOCUMENT_INVALID') {
      return 'Эта версия уже недействительна: её реквизиты не меняются. Откройте действующую версию.';
    }
    if (action === 'renew') {
      return 'Документ уже продлили или изменили. Обновите страницу: возможно, новая версия уже есть.';
    }
    if (code === 'ASSIGNEE_CANNOT_SEE') {
      return 'Этот участник не увидит документ. Выберите ответственным того, кто его видит.';
    }
    return 'Данные изменились, пока вы работали. Обновите страницу и повторите.';
  }
  if (status === 400) {
    return 'Проверьте документ: название обязательно (до 200 знаков), даты полностью, срок не раньше выдачи, у бессрочного документа нет даты окончания.';
  }
  if (action === 'load') return 'Не удалось загрузить данные. Проверьте подключение и повторите.';
  return errorMessage(error);
}
