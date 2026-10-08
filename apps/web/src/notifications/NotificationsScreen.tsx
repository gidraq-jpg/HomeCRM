import { NOTIFICATION_KINDS } from '@homecrm/shared';
import { ListChecks } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { zoneLabel } from '../household/zones.ts';
import { InstallApp } from '../pwa/InstallApp.tsx';
import { NoHousehold } from '../screens/PeopleScreen.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { type PushDevice, removeDevice, type SettingsPatch, saveSettings } from './api.ts';
import {
  budgetText,
  KIND_HINTS,
  kindLabel,
  notificationError,
  quietHoursText,
  UTILITY_KINDS,
} from './labels.ts';
import { disablePush, enablePush, forgetIfThisDevice, usePushState } from './push.ts';
import { useDevices, useRefreshNotifications, useSettings } from './queries.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;

function Failure({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  return (
    <>
      <Notice error>{notificationError(error, 'load')}</Notice>
      <button type="button" className="text-button" onClick={retry}>
        Повторить загрузку: {what}
      </button>
    </>
  );
}

/** «Это устройство»: включить или отключить, а если нельзя — объяснить, почему и что делать. */
function ThisDevice() {
  const { me } = useHousehold();
  const state = usePushState(me.id);
  const devices = useDevices();
  const refresh = useRefreshNotifications();
  const toast = useToast();
  const action = useAction();
  const known = devices.data ? devices.data.some((device) => device.id === state.deviceId) : true;
  const enabled = state.permission === 'granted' && state.deviceId !== null && known;

  let status: { tone: 'ok' | 'warning' | 'danger' | 'neutral'; text: string };
  let explanation: string | null = null;
  if (!state.supported) {
    status = { tone: 'neutral', text: 'Не поддерживается' };
    explanation =
      'Этот браузер не умеет получать push-уведомления. Откройте HomeCRM в Chrome на Android и установите приложение на телефон: так уведомления приходят надёжнее всего.';
  } else if (state.permission === 'denied') {
    status = { tone: 'danger', text: 'Запрещено в браузере' };
  } else if (enabled) {
    status = { tone: 'ok', text: 'Включено' };
  } else {
    status = { tone: 'neutral', text: 'Выключено' };
  }

  return (
    <Section title="Это устройство" aside={<Status tone={status.tone}>{status.text}</Status>}>
      {explanation ? <p className="muted">{explanation}</p> : null}
      {state.supported && state.permission === 'denied' ? (
        <div className="notif-help">
          <p>
            Браузер не разрешает этому сайту присылать уведомления. Разрешить их можно только в
            настройках браузера:
          </p>
          <ol>
            <li>
              Chrome на Android: значок слева от адреса или меню ⋮ → «Настройки» → «Настройки
              сайтов» → «Уведомления».
            </li>
            <li>
              Установленное приложение: долгое нажатие на значок HomeCRM → «О приложении» →
              «Уведомления».
            </li>
            <li>
              Chrome на компьютере: значок слева от адреса → «Настройки сайта» → «Уведомления».
            </li>
          </ol>
          <p>Выберите «Разрешить», вернитесь сюда и нажмите «Включить».</p>
        </div>
      ) : null}
      {state.supported && !enabled && state.permission !== 'denied' ? (
        <p className="muted">
          Браузер спросит разрешение. Уведомления приходят только на устройства, где они включены.
        </p>
      ) : null}
      {state.supported && enabled ? (
        <p className="muted">
          Предупреждения о сроках придут сюда, в том числе при закрытом приложении.
        </p>
      ) : null}
      {action.error ? <Notice error>{notificationError(action.error, 'enable')}</Notice> : null}
      {state.supported && state.permission !== 'denied' ? (
        <button
          type="button"
          className={enabled ? 'btn btn--secondary btn--block' : 'btn btn--primary btn--block'}
          disabled={action.disabled}
          onClick={() =>
            void action.run(async () => {
              if (enabled && state.deviceId) {
                await disablePush(me.id, state.deviceId);
                toast.show({ message: 'Уведомления на этом устройстве отключены' });
              } else {
                await enablePush(me.id);
                toast.show({ message: 'Уведомления включены на этом устройстве' });
              }
              await refresh();
            })
          }
        >
          {action.pending
            ? 'Подождите…'
            : enabled
              ? 'Отключить на этом устройстве'
              : 'Включить на этом устройстве'}
        </button>
      ) : null}
    </Section>
  );
}

function DeviceItem({
  device,
  thisDevice,
  timeZone,
}: {
  device: PushDevice;
  thisDevice: boolean;
  timeZone: string;
}) {
  const { me } = useHousehold();
  const refresh = useRefreshNotifications();
  const toast = useToast();
  const action = useAction();
  return (
    <li className="device">
      <div className="device__body">
        <strong>{device.deviceName}</strong>
        {thisDevice ? <Status tone="ok">Это устройство</Status> : null}
        <p>Добавлено: {formatDay(device.createdAt, timeZone)}</p>
        <p>
          {device.lastSuccessAt
            ? `Последняя доставка: ${formatMoment(device.lastSuccessAt, timeZone)}`
            : 'Доставок пока не было'}
        </p>
        {action.error ? <Notice error>{notificationError(action.error, 'remove')}</Notice> : null}
      </div>
      <button
        type="button"
        className="btn btn--secondary"
        disabled={action.disabled}
        aria-label={`Отключить устройство: ${device.deviceName}`}
        onClick={() =>
          void action.run(async () => {
            // Устройство этого браузера отключается целиком: и на сервере, и в самом браузере.
            if (!(await forgetIfThisDevice(me.id, device.id))) await removeDevice(device.id);
            await refresh();
            toast.show({
              message: 'Устройство отключено',
              detail: 'Уведомления на него больше не придут.',
            });
          })
        }
      >
        {action.pending ? 'Отключаем…' : 'Отключить'}
      </button>
    </li>
  );
}

function Devices() {
  const { me } = useHousehold();
  const state = usePushState(me.id);
  const devices = useDevices();
  let body = null;
  if (devices.isPending) body = <Notice>Загружаем устройства…</Notice>;
  else if (devices.isError)
    body = <Failure error={devices.error} retry={() => void devices.refetch()} what="устройства" />;
  else if (devices.data.length === 0)
    body = (
      <p className="muted">
        Устройств пока нет. Включите уведомления на телефоне: оно появится в этом списке.
      </p>
    );
  else
    body = (
      <ul className="device-list" aria-label="Мои устройства">
        {devices.data.map((device) => (
          <DeviceItem
            key={device.id}
            device={device}
            thisDevice={device.id === state.deviceId}
            timeZone={me.timeZone}
          />
        ))}
      </ul>
    );
  return (
    <Section title="Мои устройства">
      <p className="muted">Видите и отключаете вы только свои устройства.</p>
      {body}
    </Section>
  );
}

const OTHER_KINDS = NOTIFICATION_KINDS.filter(
  (kind) => !(UTILITY_KINDS as readonly string[]).includes(kind),
);

function KindToggle({
  kind,
  draft,
  set,
}: {
  kind: string;
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
}) {
  return (
    <CheckLine
      checked={draft.kinds.includes(kind)}
      onChange={(checked) =>
        set({
          kinds: checked ? [...draft.kinds, kind] : draft.kinds.filter((item) => item !== kind),
        })
      }
    >
      <strong>{kindLabel(kind)}</strong>
      <span className="check-hint">{KIND_HINTS[kind]}</span>
    </CheckLine>
  );
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Draft {
  quietStart: string;
  quietEnd: string;
  budget: string;
  kinds: string[];
  hideText: boolean;
}

function SettingsForm({ settings, timeZone }: { settings: Draft; timeZone: string }) {
  const [draft, setDraft] = useState<Draft>(settings);
  const [invalid, setInvalid] = useState<string | null>(null);
  const refresh = useRefreshNotifications();
  const toast = useToast();
  const save = useAction();
  const startId = useId();
  const endId = useId();
  const budgetId = useId();
  const errorId = useId();

  const changed =
    draft.quietStart !== settings.quietStart ||
    draft.quietEnd !== settings.quietEnd ||
    draft.budget !== settings.budget ||
    draft.hideText !== settings.hideText ||
    draft.kinds.join() !== settings.kinds.join();
  const set = (patch: Partial<Draft>) => {
    setInvalid(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!CLOCK.test(draft.quietStart) || !CLOCK.test(draft.quietEnd)) {
      setInvalid('Укажите начало и конец тихих часов: время в формате «часы:минуты».');
      return;
    }
    const budget = /^\d{1,3}$/.test(draft.budget) ? Number(draft.budget) : -1;
    if (budget < 0 || budget > 100) {
      setInvalid('Дневной бюджет — целое число от 0 до 100.');
      return;
    }
    const patch: SettingsPatch = {
      quietStart: draft.quietStart,
      quietEnd: draft.quietEnd,
      dailyBudget: budget,
      enabledKinds: NOTIFICATION_KINDS.filter((kind) => draft.kinds.includes(kind)),
      hideText: draft.hideText,
    };
    void save.run(async () => {
      await saveSettings(patch);
      await refresh();
      toast.show({ message: 'Настройки уведомлений сохранены' });
    });
  }

  const budgetNumber = /^\d{1,3}$/.test(draft.budget) ? Number(draft.budget) : null;
  return (
    <form className="notif-form" onSubmit={submit} aria-busy={save.pending} noValidate>
      <Section title="Тихие часы">
        <p className="muted">
          В это время push не приходят и ждут конца тихих часов. Время — по часовому поясу дома:{' '}
          {zoneLabel(timeZone)}.
        </p>
        <div className="notif-time">
          <div className="field">
            <label className="field__label" htmlFor={startId}>
              С
            </label>
            <input
              id={startId}
              className="input"
              type="time"
              value={draft.quietStart}
              onChange={(event) => set({ quietStart: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={endId}>
              До
            </label>
            <input
              id={endId}
              className="input"
              type="time"
              value={draft.quietEnd}
              onChange={(event) => set({ quietEnd: event.target.value })}
            />
          </div>
        </div>
        <p className="field__hint">
          Сейчас: {quietHoursText(draft.quietStart, draft.quietEnd)}. Если начало и конец совпадают,
          тихие часы выключены.
        </p>
      </Section>

      <Section title="Дневной бюджет">
        <div className="field">
          <label className="field__label" htmlFor={budgetId}>
            Сколько уведомлений в день
          </label>
          <input
            id={budgetId}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.budget}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => set({ budget: event.target.value.trim() })}
          />
          <p className="field__hint">
            {budgetNumber === null ? 'От 0 до 100.' : `Не больше ${budgetText(budgetNumber)}.`} Одно
            предупреждение на двух устройствах считается за одно. Остальные на телефон не придут: их
            соберёт сводка, когда она появится.
          </p>
        </div>
      </Section>

      <Section title="Какие уведомления присылать">
        {OTHER_KINDS.map((kind) => (
          <KindToggle key={kind} kind={kind} draft={draft} set={set} />
        ))}
      </Section>

      <Section title="Коммунальные сроки">
        <p className="muted">
          Окна показаний, оплата и поверка приходят отдельными видами: включайте только нужные.
        </p>
        {UTILITY_KINDS.map((kind) => (
          <KindToggle key={kind} kind={kind} draft={draft} set={set} />
        ))}
        <p className="field__hint">Другие виды появятся вместе с разделами, которым они нужны.</p>
      </Section>
      <Section title="Экран блокировки">
        <CheckLine checked={draft.hideText} onChange={(checked) => set({ hideText: checked })}>
          <strong>Скрывать текст на экране блокировки</strong>
          <span className="check-hint">
            Уведомление покажет только «В HomeCRM есть новое». Названий записей в нём нет и без этой
            настройки.
          </span>
        </CheckLine>
      </Section>

      {invalid ? (
        <p className="field__error" id={errorId} role="alert">
          {invalid}
        </p>
      ) : null}
      {save.error ? <Notice error>{notificationError(save.error, 'save')}</Notice> : null}
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={save.disabled || !changed}
      >
        {save.pending ? 'Сохраняем…' : 'Сохранить настройки'}
      </button>
    </form>
  );
}

function Settings() {
  const { me } = useHousehold();
  const settings = useSettings();
  if (settings.isPending) return <Notice>Загружаем настройки…</Notice>;
  if (settings.isError)
    return (
      <Failure error={settings.error} retry={() => void settings.refetch()} what="настройки" />
    );
  const { quietStart, quietEnd, dailyBudget, enabledKinds, hideText } = settings.data;
  return (
    <SettingsForm
      // Новые значения с сервера пересоздают форму: черновик не расходится с сохранённым.
      key={`${quietStart}|${quietEnd}|${dailyBudget}|${enabledKinds.join()}|${hideText}`}
      timeZone={me.timeZone}
      settings={{
        quietStart,
        quietEnd,
        budget: String(dailyBudget),
        kinds: [...enabledKinds],
        hideText,
      }}
    />
  );
}

/** «Ещё» → «Уведомления»: устройство, список устройств, тихие часы, бюджет, виды, экран блокировки (NOTIF-1, 4, 6). */
export function NotificationsScreen() {
  const { householdId } = useHousehold();
  if (householdId === null) {
    return (
      <Page title="Уведомления" back={BACK}>
        <NoHousehold />
      </Page>
    );
  }
  return (
    <Page title="Уведомления" back={BACK}>
      <ThisDevice />
      <Devices />
      <Settings />
      <Section title="Журнал доставки">
        <RowList label="Журнал">
          <Row
            to="/more/notifications/log"
            icon={<ListChecks size={22} aria-hidden />}
            title="Журнал доставки"
            meta="Когда, какого вида, на какое устройство и чем закончилось"
          />
        </RowList>
      </Section>
      <InstallApp inline />
    </Page>
  );
}
