import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API заметок (ADR-0020). Технические сообщения сервера не показываются. Каждое
// объяснение говорит, что делать дальше; заголовков и текстов заметок в сообщениях нет.

export type NoteAction =
  | 'load'
  | 'create'
  | 'save'
  | 'toggle'
  | 'trash'
  | 'restore'
  | 'share'
  | 'personal'
  | 'audience'
  | 'copy'
  | 'preview';

/** Заметку кто-то изменил после того, как её открыли: правку нужно сверить с новой версией. */
export function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'STALE_VERSION';
}

export function noteErrorMessage(error: unknown, action: NoteAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 404) {
    return 'Заметки больше нет, или она стала вам недоступна. Вернитесь к списку заметок и обновите его.';
  }
  if (status === 403) {
    switch (action) {
      case 'personal':
        return 'Сделать заметку личной нельзя: в ней есть правки других участников. Скопируйте её в личное.';
      case 'trash':
        return 'Убрать общую заметку в корзину могут только взрослые.';
      case 'restore':
        return 'Вернуть общую заметку из корзины может её автор-взрослый или администратор.';
      case 'share':
        return 'Поделиться можно только своей личной заметкой.';
      case 'audience':
        return 'Менять, кто видит заметку, могут только взрослые.';
      case 'create':
      case 'save':
      case 'toggle':
        return 'Эту заметку вам править нельзя. Обновите страницу: возможно, права изменились.';
      default:
        return 'Это действие вам недоступно. Обновите страницу и повторите.';
    }
  }
  if (status === 409) {
    if (isStaleVersion(error))
      return 'Заметку изменили, пока вы её правили. Обновите её и повторите.';
    if (code === 'ASSIGNEE_CANNOT_SEE') {
      return 'Сузить доступ до «Взрослых» нельзя: за заметку или её пункт отвечает ребёнок. Сначала назначьте ответственным взрослого.';
    }
    if (code === 'CONFIRMATION_REQUIRED') return 'Нужно подтвердить действие. Повторите его.';
    return 'Данные изменились, пока вы работали. Обновите страницу и повторите.';
  }
  if (status === 400) {
    return 'Проверьте заметку: заголовок обязателен и не длиннее 200 знаков, текст — до 100 000 знаков, в чек-листе — не больше 200 пунктов.';
  }
  if (action === 'load') return 'Не удалось загрузить заметки. Проверьте подключение и повторите.';
  return errorMessage(error);
}
