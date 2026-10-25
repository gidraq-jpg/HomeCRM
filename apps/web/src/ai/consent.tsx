import { useRef, useState } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Sheet } from '../ui/Sheet.tsx';

export const consentKey = (member: string, house: string | null, provider?: string) =>
  `homecrm:ai-consent:v4:${provider}:${member}:${house}`;

export function useAiConsent(house: string | null, provider?: string) {
  const { me } = useHousehold();
  const key = consentKey(me.id, house, provider);
  const [open, setOpen] = useState(false);
  const accepted = useRef(new Set<string>());
  const action = useRef<(() => void) | null>(null);
  function ask(next: () => void) {
    action.current = next;
    let known = accepted.current.has(key);
    try {
      known ||= localStorage.getItem(key) === 'yes';
    } catch {
      /* Согласие остаётся в памяти страницы. */
    }
    if (known) next();
    else setOpen(true);
  }
  const dialog = open ? (
    <Sheet
      open
      title="Разбор с помощью ИИ"
      description="Перед первой отправкой"
      onOpenChange={setOpen}
    >
      <p>
        Выбранные текст или фото, сегодняшняя дата, имена участников и названия доступных вам
        объектов уйдут через поставщика ИИ ({provider?.split(':')[0]}). Для счётчика передаются его
        ресурс, зоны, разрядность, единица и прошлое значение. Для квитанции — номера доступных вам
        лицевых счетов.
      </p>
      <p>
        Другие записи и файлы не отправляются. Документы личности заполняются вручную; ИИ может
        только проверить, похоже ли фото на такой документ, без извлечения полей.
      </p>
      <p>
        ИИ предложит черновики. Ничего не сохранится, пока вы не проверите их и не нажмёте
        «Сохранить». Фото без галочки приложения не хранится.
      </p>
      <p className="muted">Согласие запомнится для вас, этого дома и поставщика в этом браузере.</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            accepted.current.add(key);
            try {
              localStorage.setItem(key, 'yes');
            } catch {
              /* При запрете хранилища — до закрытия страницы. */
            }
            setOpen(false);
            action.current?.();
            action.current = null;
          }}
        >
          Согласен, разобрать
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            setOpen(false);
            action.current = null;
          }}
        >
          Отмена
        </button>
      </div>
    </Sheet>
  ) : null;
  return { ask, dialog };
}
