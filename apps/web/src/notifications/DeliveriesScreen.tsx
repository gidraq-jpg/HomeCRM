import { Notice } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Page } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import type { Delivery } from './api.ts';
import { kindLabel, notificationError, resultInfo } from './labels.ts';
import { useDeliveries, useDevices } from './queries.ts';

const BACK = { to: '/more/notifications', label: 'Уведомления' } as const;
const REMOVED_DEVICE = 'Отключённое устройство';

function Attempt({
  delivery,
  device,
  timeZone,
}: {
  delivery: Delivery;
  device: string;
  timeZone: string;
}) {
  const result = resultInfo(delivery.result, delivery.errorCode);
  return (
    <li className="log-item">
      <strong>{formatMoment(delivery.attemptedAt, timeZone)}</strong>
      <span className="log-item__kind">{kindLabel(delivery.kind)}</span>
      <span className="log-item__device">{device}</span>
      <Status tone={result.tone}>{result.text}</Status>
    </li>
  );
}

/**
 * «Журнал доставки» (NOTIF-7): последние 100 попыток отправки push своим устройствам. Журнал хранит
 * вид, момент, устройство и итог; названий и текстов записей в нём нет, поэтому их нет и здесь.
 */
export function DeliveriesScreen() {
  const { me } = useHousehold();
  const deliveries = useDeliveries();
  const devices = useDevices();
  // Устройство, которое уже отключили, остаётся в журнале безымянным: адрес и ключи не хранятся.
  const names = new Map((devices.data ?? []).map((device) => [device.id, device.deviceName]));

  let body = null;
  if (deliveries.isPending) body = <Notice>Загружаем журнал…</Notice>;
  else if (deliveries.isError)
    body = (
      <>
        <Notice error>{notificationError(deliveries.error, 'load')}</Notice>
        <button type="button" className="text-button" onClick={() => void deliveries.refetch()}>
          Повторить загрузку журнала
        </button>
      </>
    );
  else if (deliveries.data.length === 0)
    body = (
      <p className="muted">
        Попыток отправки пока не было. Они появятся, когда подойдёт срок записи и на устройство
        уйдёт уведомление.
      </p>
    );
  else
    body = (
      <ul className="log-list" aria-label="Попытки отправки">
        {deliveries.data.map((delivery) => (
          <Attempt
            key={delivery.id}
            delivery={delivery}
            device={names.get(delivery.deviceId) ?? REMOVED_DEVICE}
            timeZone={me.timeZone}
          />
        ))}
      </ul>
    );

  return (
    <Page title="Журнал доставки" back={BACK}>
      <p className="muted">
        Последние 100 попыток отправить уведомление на ваши устройства. «Принято службой push»
        значит, что служба взяла сообщение; прочитал ли его человек, журнал не знает. Названий
        записей здесь нет.
      </p>
      {body}
    </Page>
  );
}
