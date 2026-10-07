import { BellRinging } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { INSTALL_HELP, useInstall } from '../pwa/InstallApp.tsx';
import { useToast } from '../ui/Toast.tsx';
import { notificationError } from './labels.ts';
import { dismissPushCard, enablePush, PushError, usePushState } from './push.ts';
import { useRefreshNotifications } from './queries.ts';

/**
 * Карточка на «Сегодня» (NOTIF-1): помочь установить приложение и включить уведомления. Ненавязчивая:
 * один блок под срочным, «Не сейчас» убирает её насовсем, а отказ в разрешении не повторяется —
 * объяснение остаётся в «Ещё» → «Уведомления».
 */
export function PushCard() {
  const { me, householdId } = useHousehold();
  const state = usePushState(me.id);
  const { installed, install } = useInstall();
  const toast = useToast();
  const refresh = useRefreshNotifications();
  const enable = useAction();
  const [help, setHelp] = useState(false);
  const titleId = useId();

  const enabled = state.permission === 'granted' && state.deviceId !== null;
  const hidden =
    householdId === null ||
    state.dismissed ||
    (state.supported ? state.permission === 'denied' || enabled : installed);
  if (hidden) return null;

  function turnOn() {
    void enable.run(async () => {
      try {
        await enablePush(me.id);
      } catch (error) {
        // Отказ в разрешении объясняем сообщением: сама карточка после него пропадёт.
        if (error instanceof PushError && error.code === 'denied')
          toast.show({
            message: 'Уведомления не включены',
            detail: 'Они запрещены в браузере. Как разрешить — в «Ещё» → «Уведомления».',
            durationMs: 10_000,
          });
        throw error;
      }
      await refresh();
      toast.show({ message: 'Уведомления включены на этом устройстве' });
    });
  }

  return (
    <section className="card push-card" aria-labelledby={titleId}>
      <div className="push-card__head">
        <span className="push-card__icon">
          <BellRinging size={22} aria-hidden />
        </span>
        <h2 className="card__title" id={titleId}>
          {state.supported ? 'Уведомления о сроках' : 'Установите приложение на телефон'}
        </h2>
      </div>
      <p className="muted">
        {state.supported
          ? 'Включите уведомления, и срок не пройдёт незамеченным. Текст на экране блокировки по умолчанию скрыт.'
          : 'Этот браузер не умеет присылать уведомления. Установите HomeCRM на телефон или откройте его в Chrome на Android.'}
      </p>
      {enable.error ? <Notice error>{notificationError(enable.error, 'enable')}</Notice> : null}
      {help ? <p role="status">{INSTALL_HELP}</p> : null}
      <div className="btn-row">
        {state.supported ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={enable.disabled}
            onClick={turnOn}
          >
            {enable.pending ? 'Включаем…' : 'Включить уведомления'}
          </button>
        ) : null}
        {installed ? null : (
          <button
            type="button"
            className={state.supported ? 'btn btn--secondary' : 'btn btn--primary'}
            onClick={async () => {
              if ((await install()) === 'help') setHelp(true);
            }}
          >
            Установить приложение
          </button>
        )}
      </div>
      <button type="button" className="text-button" onClick={dismissPushCard}>
        Не сейчас
      </button>
    </section>
  );
}
