import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ошибок файлов: что случилось и что делать дальше. Технические сообщения сервера и
// названия файлов в них не попадают.

export type FileAction = 'upload' | 'trash' | 'restore' | 'photo';

/** Причины, которые клиент находит сам, до отправки на сервер. */
export type LocalReason = 'size' | 'type' | 'empty';

export const LIMIT_TEXT = '25 МБ';

export const LOCAL_MESSAGES: Readonly<Record<LocalReason, string>> = {
  size: `Файл больше ${LIMIT_TEXT}. Уменьшите его или выберите другой.`,
  type: 'Этот формат не подходит. Добавьте фото (JPEG, PNG, WebP, HEIC) или PDF.',
  empty: 'Файл пустой. Выберите другой.',
};

export function fileErrorMessage(error: unknown, action: FileAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 413) return LOCAL_MESSAGES.size;
  if (status === 415) {
    return 'Не удалось принять файл: формат не подходит или файл повреждён. Подойдут фото (JPEG, PNG, WebP, HEIC) и PDF.';
  }
  if (status === 404) {
    return 'Записи или файла больше нет, либо они стали вам недоступны. Обновите страницу.';
  }
  if (status === 403) {
    if (action === 'trash') return 'Убрать этот файл в корзину могут только взрослые участники.';
    if (action === 'restore') {
      return 'Вернуть файл может его автор-взрослый или администратор.';
    }
    return 'Добавлять файлы к этой записи вам нельзя. Обновите страницу: возможно, права изменились.';
  }
  if (status === 400) {
    return action === 'photo'
      ? 'Не удалось сохранить фото. Выберите другое изображение и повторите.'
      : 'Не удалось принять файл. Выберите другой и повторите.';
  }
  return errorMessage(error);
}
