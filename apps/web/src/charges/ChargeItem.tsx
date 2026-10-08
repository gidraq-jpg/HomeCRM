import { CaretDown, CaretUp, CurrencyRub, Paperclip, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Notice } from '../auth/components.tsx';
import { fileUrl } from '../files/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { noteAbilities, viewerOf } from '../notes/abilities.ts';
import type { ObjectCard } from '../objects/api.ts';
import { usePersonName } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { type DateOnly, formatRub, formatShortDate } from '../ui/format.ts';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { Status, type StatusTone } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  type Charge,
  cancelCharge,
  cancelPayment,
  createPayment,
  type Payment,
  type PaymentInput,
} from './api.ts';
import { ChargeError } from './components.tsx';
import {
  type ChargeStatus,
  chargeStatus,
  METHOD_LABELS,
  overpaidCents,
  periodLabel,
  STATUS_LABELS,
} from './labels.ts';
import { usePayments, useRefreshCharges } from './queries.ts';
import { CancelSheet, PaymentSheet } from './Sheets.tsx';

const STATUS_TONES: Readonly<Record<ChargeStatus, StatusTone>> = {
  due: 'warning',
  partial: 'warning',
  paid: 'ok',
  cancelled: 'neutral',
};

function Receipts({
  ids,
  card,
  label,
}: {
  ids: readonly string[];
  card: Pick<ObjectCard, 'files'>;
  label: string;
}) {
  const files = ids.flatMap((id) => {
    const file = card.files.find((item) => item.id === id);
    return file === undefined ? [] : [file];
  });
  if (files.length === 0) return null;
  return (
    <>
      {files.map((file) => (
        <a key={file.id} className="charge-receipt" href={fileUrl(file.id)} {...EXTERNAL_LINK}>
          <Paperclip size={16} aria-hidden />
          {label}: {file.name}
        </a>
      ))}
    </>
  );
}

function PaymentItem({
  payment,
  card,
  canCancel,
  onCancel,
}: {
  payment: Payment;
  card: ObjectCard;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const { me } = useHousehold();
  const nameOf = usePersonName();
  const today = todayIn(me.timeZone);
  const cancelled = payment.cancelledAt !== null;
  const amount = formatRub(payment.amountCents);
  const date = formatShortDate(payment.paidOn as DateOnly, today);
  const payer = payment.payer.kind === 'tenant' ? 'Арендатор' : nameOf(payment.payer.accountId);
  return (
    <li className={cancelled ? 'payment payment--cancelled' : 'payment'}>
      <div className="payment__head">
        {cancelled ? <del>{amount}</del> : <strong>{amount}</strong>}
        <span>{date}</span>
        {cancelled ? <Status tone="neutral">Отменена</Status> : null}
      </div>
      <p className="payment__meta">
        {payer} · {METHOD_LABELS[payment.method]}
      </p>
      <Receipts ids={payment.receiptIds} card={card} label="Чек" />
      {cancelled ? (
        <p className="payment__reason">Причина отмены: {payment.cancellationReason}</p>
      ) : canCancel ? (
        <button
          type="button"
          className="text-button"
          aria-label={`Отменить оплату ${amount} от ${date}`}
          onClick={onCancel}
        >
          Отменить оплату
        </button>
      ) : null}
    </li>
  );
}

/**
 * Начисление в списке (UTIL-9, UTIL-10): период, статус, итог и строки, оплаты с отменой.
 * Денежные записи не удаляются: начисление и оплату отменяют с причиной, отменённые остаются видны.
 */
export function ChargeItem({ charge, card }: { charge: Charge; card: ObjectCard }) {
  const { me, householdId } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshCharges();
  const [expanded, setExpanded] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState<'charge' | Payment | null>(null);
  const payments = usePayments(charge.id, expanded);

  const today = todayIn(me.timeZone);
  const viewer = viewerOf(me);
  const canWrite =
    card.deletedAt === null && noteAbilities(viewer, charge, householdId, 'utility_charge').edit;
  const canCancelPayment =
    card.deletedAt === null && noteAbilities(viewer, charge, householdId, 'utility_payment').edit;

  const status = chargeStatus(charge);
  const open = status === 'due' || status === 'partial';
  const overdue = open && charge.dueOn < today;
  const over = overpaidCents(charge);
  const label = periodLabel(charge.period);
  const cancelled = status === 'cancelled';

  async function addPayment(input: PaymentInput) {
    await createPayment(charge.id, input);
    await refresh();
    setPaying(false);
    setExpanded(true);
    toast.show({ message: 'Оплата сохранена' });
  }

  async function cancelOne(payment: Payment, reason: string) {
    await cancelPayment(payment.id, reason);
    await refresh();
    setCancelling(null);
    toast.show({ message: 'Оплата отменена', detail: 'Она осталась в истории с причиной.' });
  }

  async function cancelWhole(reason: string) {
    await cancelCharge(charge.id, reason);
    await refresh();
    setCancelling(null);
    toast.show({ message: 'Начисление отменено', detail: 'Оно осталось в истории с причиной.' });
  }

  return (
    <li className="card charge-card" aria-label={`Начисление: ${label}`}>
      <div className="charge-card__head">
        <h3 className="card__title">{label}</h3>
        <span className="charge-card__status">
          <Status tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Status>
          {overdue ? <Status tone="danger">Просрочено</Status> : null}
        </span>
      </div>

      {charge.lines.length > 0 ? (
        <ul className="charge-lines" aria-label={`Строки начисления: ${label}`}>
          {charge.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: строки начисления не меняются и могут повторяться
            <li key={index}>
              <span>
                {line.title}
                {line.kind === 'adjustment' ? (
                  <em className="charge-lines__kind"> · перерасчёт</em>
                ) : null}
              </span>
              <span className="mono">{formatRub(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="facts facts--fields">
        <div className="facts__item">
          <dt>Итого</dt>
          <dd>
            {cancelled ? <del>{formatRub(charge.totalCents)}</del> : formatRub(charge.totalCents)}
          </dd>
        </div>
        {cancelled ? null : (
          <>
            <div className="facts__item">
              <dt>Оплачено</dt>
              <dd>{formatRub(charge.paidCents)}</dd>
            </div>
            <div className="facts__item">
              <dt>{over > 0 ? 'Переплата' : 'Осталось'}</dt>
              <dd>{formatRub(over > 0 ? over : charge.remainingCents)}</dd>
            </div>
          </>
        )}
        <div className="facts__item">
          <dt>Срок оплаты</dt>
          <dd>{formatShortDate(charge.dueOn as DateOnly, today)}</dd>
        </div>
      </dl>
      <Receipts ids={charge.receiptIds} card={card} label="Квитанция" />
      {cancelled ? (
        <Notice>
          <strong>Начисление отменено.</strong> Причина: {charge.cancellationReason}
        </Notice>
      ) : null}

      <div className="btn-row">
        {open && canWrite ? (
          <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}>
            <CurrencyRub size={20} aria-hidden />
            Добавить оплату
          </button>
        ) : null}
        {cancelled ? null : (
          <button
            type="button"
            className="btn btn--secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <CaretUp size={20} aria-hidden /> : <CaretDown size={20} aria-hidden />}
            Оплаты
          </button>
        )}
        {!cancelled && canWrite ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setCancelling('charge')}
          >
            <XCircle size={20} aria-hidden />
            Отменить начисление
          </button>
        ) : null}
      </div>

      {expanded && !cancelled ? (
        <div className="charge-payments">
          {payments.isPending ? <Notice>Загружаем оплаты…</Notice> : null}
          {payments.isError ? (
            <>
              <ChargeError error={payments.error} action="load" />
              <button className="text-button" type="button" onClick={() => void payments.refetch()}>
                Повторить загрузку оплат
              </button>
            </>
          ) : null}
          {payments.data && payments.data.length === 0 ? (
            <p className="muted">Оплат пока нет.</p>
          ) : null}
          {payments.data && payments.data.length > 0 ? (
            <ul className="payment-list" aria-label={`Оплаты: ${label}`}>
              {payments.data.map((payment) => (
                <PaymentItem
                  key={payment.id}
                  payment={payment}
                  card={card}
                  canCancel={canCancelPayment}
                  onCancel={() => setCancelling(payment)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {paying ? (
        <PaymentSheet
          card={card}
          remainingCents={charge.remainingCents}
          today={today}
          onSubmit={addPayment}
          onClose={() => setPaying(false)}
        />
      ) : null}
      {cancelling === 'charge' ? (
        <CancelSheet
          title="Отменить начисление"
          description="Начисление не удаляется: оно останется в истории с причиной. Сначала нужно отменить его оплаты."
          confirmLabel="Отменить начисление"
          pendingLabel="Отменяем…"
          action="cancel-charge"
          onSubmit={cancelWhole}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {cancelling !== null && cancelling !== 'charge' ? (
        <CancelSheet
          title="Отменить оплату"
          description="Оплата не удаляется: она останется в списке зачёркнутой, с причиной. Срок оплаты снова откроется, если остаток больше нуля."
          confirmLabel="Отменить оплату"
          pendingLabel="Отменяем…"
          action="cancel-payment"
          onSubmit={(reason) => cancelOne(cancelling, reason)}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </li>
  );
}
