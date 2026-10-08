import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API шаблонов (ADR-0034). Каждое сообщение говорит, что ничего не создано и что
// делать дальше: шаблон применяется одним действием, ошибка любого пункта откатывает всё.

const NOTHING = 'Ничего не создано.';

export function templateErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  // Ответ мог потеряться уже после создания: повтор с тем же ключом вернёт тот же объект.
  if (status === 0) {
    return 'Нет связи с сервером, поэтому неизвестно, создался ли объект. Проверьте подключение и нажмите кнопку ещё раз: второго объекта не будет.';
  }
  if (status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (code === 'IDEMPOTENCY_KEY_REUSED') {
    return `Это действие уже выполнялось с другими настройками. Обновите страницу и повторите. ${NOTHING}`;
  }
  if (code === 'TEMPLATE_RESULT_UNAVAILABLE') {
    return 'Объект из этого шаблона уже создан, но сейчас недоступен. Откройте «Дом» и обновите список.';
  }
  if (code === 'TEMPLATE_ITEM_UNAVAILABLE') {
    return `Один из пунктов не относится к этому шаблону. Обновите страницу и повторите. ${NOTHING}`;
  }
  if (code === 'HOUSE_REQUIRED') {
    return `Для сроков нужен дом: сделайте объект общим или снимите галочки со сроков. ${NOTHING}`;
  }
  if (status === 403) {
    return `Создавать общие объекты могут только взрослые. Выберите «Только я». ${NOTHING}`;
  }
  if (status === 404)
    return `Шаблона или места для объекта больше нет. Обновите страницу. ${NOTHING}`;
  if (status === 409)
    return `Данные изменились, пока вы работали. Обновите страницу и повторите. ${NOTHING}`;
  if (status === 400) {
    return `Проверьте форму: название обязательно, показания — числа с запятой, поставщик и место должны быть доступны вам. ${NOTHING}`;
  }
  return `${errorMessage(error)} ${NOTHING}`;
}
