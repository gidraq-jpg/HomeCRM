import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { cancelPayment } from '../charges/api.ts';
import { useRefreshCharges } from '../charges/queries.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { computedNextVerification } from '../meters/form.ts';
import { useRefreshMeters } from '../meters/queries.ts';
import { todayIn } from '../objects/dates.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { completePayment, completeReadings, fetchMeterCard, verifyMeter } from './api.ts';
import { DeadlineError } from './components.tsx';
import { useRefreshDeadlines } from './queries.ts';
import type { UtilityRow } from './radar.ts';

// Действия над коммунальными сроками прямо из радара и с «Сегодня» (UTIL-13, DEAD-4, DEAD-5).
// Управляемый срок не правится и не удаляется: вместо этого — «Открыть счёт» или «Открыть счётчик».

/** Подпись основной кнопки: берём ту, что прислал сервер, иначе запасную. */
const FALLBACK = {
  enter_readings: 'Внести показания',
  mark_payment: 'Отметить оплату',
  verify_meter: 'Поверка проведена',
} as const;

export function readingsPath(objectId: string): string {
  return `/home/${objectId}/readings`;
}

/** «Передано» для окна без счётчиков; отмена — в сообщении внизу экрана. */
export function MarkReadingsButton({
  occurrenceId,
  label,
}: {
  occurrenceId: string;
  label: string;
}) {
  const refresh = useRefreshDeadlines();
  const toast = useToast();
  const state = useAction();
  return (
    <>
      <DeadlineError error={state.error} action="mark" />
      <button
        type="button"
        className="btn btn--secondary btn--block"
        disabled={state.disabled}
        onClick={() =>
          void state.run(async () => {
            await completeReadings(occurrenceId, true);
            await refresh();
            toast.show({
              message: 'Окно отмечено как переданное',
              action: {
                label: 'Отменить',
                onClick: () => {
                  completeReadings(occurrenceId, false)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Отметка снята' }))
                    .catch(() => toast.show({ message: 'Не удалось снять отметку' }));
                },
              },
            });
          })
        }
      >
        {state.pending ? 'Отмечаем…' : label}
      </button>
    </>
  );
}

/** Причина отмены оплаты, созданной отметкой в радаре, если её сняли сразу: деньги не удаляются. */
export const UNDO_MARK_REASON = 'Отметка снята сразу после создания';

function MarkPaymentButton({ occurrenceId, label }: { occurrenceId: string; label: string }) {
  const refresh = useRefreshDeadlines();
  const refreshCharges = useRefreshCharges();
  const toast = useToast();
  const state = useAction();

  async function mark() {
    const marked = await completePayment(occurrenceId, true);
    const markedCharge = marked.chargeId ?? null;
    if (markedCharge === null) {
      // Срок без начисления: прежняя отметка, её снимает тот же вызов.
      await Promise.all([refresh(), refreshCharges()]);
      toast.show({
        message: 'Оплата отмечена',
        action: {
          label: 'Отменить',
          onClick: () => {
            completePayment(occurrenceId, false)
              .then(() => Promise.all([refresh(), refreshCharges()]))
              .then(() => toast.show({ message: 'Отметка об оплате снята' }))
              .catch(() => toast.show({ message: 'Не удалось снять отметку' }));
          },
        },
      });
      return;
    }
    await Promise.all([refresh(), refreshCharges()]);
    if (marked.paymentId === null) {
      toast.show({ message: 'Начисление уже оплачено', detail: 'Новая оплата не создана.' });
    } else {
      const paymentId = marked.paymentId;
      toast.show({
        message: 'Оплата отмечена',
        detail: 'Оплата на остаток записана в начислении.',
        action: {
          label: 'Отменить',
          onClick: () => {
            // Начисление: оплата отменяется с причиной, а не снимается флажком (UTIL-10).
            cancelPayment(paymentId, UNDO_MARK_REASON)
              .then(() => Promise.all([refresh(), refreshCharges()]))
              .then(() => toast.show({ message: 'Оплата отменена' }))
              .catch(() => toast.show({ message: 'Не удалось снять отметку' }));
          },
        },
      });
    }
  }

  return (
    <>
      <DeadlineError error={state.error} action="mark" />
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={state.disabled}
        onClick={() => void state.run(mark)}
      >
        {state.pending ? 'Отмечаем…' : label}
      </button>
    </>
  );
}
/** «Поверка проведена»: дата поверки и следующая дата, по умолчанию — от интервала счётчика. */
function VerifySheet({ meterId, onClose }: { meterId: string; onClose: () => void }) {
  const { me } = useHousehold();
  const today = todayIn(me.timeZone);
  const meter = useQuery({
    queryKey: ['meters', meterId, 'card'],
    queryFn: ({ signal }) => fetchMeterCard(meterId, signal),
  });
  const refreshDeadlines = useRefreshDeadlines();
  const refreshMeters = useRefreshMeters();
  const toast = useToast();
  const state = useAction();
  const [verifiedOn, setVerifiedOn] = useState<string>(today);
  const [next, setNext] = useState<string | null>(null);
  const verifiedId = useId();
  const nextId = useId();

  const data = meter.data?.data;
  const suggested = data
    ? (computedNextVerification(
        data.resource,
        verifiedOn,
        data.verificationYears === undefined ? '' : String(data.verificationYears),
      ) ?? '')
    : '';
  const nextValue = next ?? suggested;
  const invalid = verifiedOn === '' || verifiedOn > today;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    void state.run(async () => {
      await verifyMeter(meterId, {
        verifiedOn,
        // Пока дату не меняли вручную, следующую поверку считает сервер по интервалу.
        ...(next === null ? {} : { nextVerificationOn: next === '' ? null : next }),
      });
      await Promise.all([refreshDeadlines(), refreshMeters()]);
      toast.show({ message: 'Поверка отмечена' });
      onClose();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Поверка проведена"
      description="Укажите дату поверки. Следующая дата считается по интервалу счётчика, её можно изменить."
    >
      {meter.isPending ? <Notice>Загружаем счётчик…</Notice> : null}
      {meter.isError ? <DeadlineError error={meter.error} action="load" /> : null}
      {meter.data ? (
        <form className="sheet__block" onSubmit={submit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={verifiedId}>
              Дата поверки
            </label>
            <input
              id={verifiedId}
              className="input"
              type="date"
              value={verifiedOn}
              max={today}
              aria-invalid={invalid}
              onChange={(event) => setVerifiedOn(event.target.value)}
            />
            {invalid ? (
              <p className="field__error" role="alert">
                Укажите дату не позже сегодняшней.
              </p>
            ) : null}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={nextId}>
              Следующая поверка
            </label>
            <input
              id={nextId}
              className="input"
              type="date"
              value={nextValue}
              onChange={(event) => setNext(event.target.value)}
            />
            <p className="field__hint">
              Если оставить дату по умолчанию, её пересчитает сервер по интервалу поверки.
            </p>
          </div>
          <DeadlineError error={state.error} action="verify" />
          <div className="btn-row">
            <button type="submit" className="btn btn--primary" disabled={state.disabled || invalid}>
              {state.pending ? 'Сохраняем…' : 'Отметить поверку'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}

function VerifyButton({ meterId, label }: { meterId: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--primary btn--block" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <VerifySheet meterId={meterId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Основное действие и «Открыть счёт» / «Открыть счётчик» под пунктом радара. Окно без счётчиков —
 * подсказка «Добавьте счётчики» (вкладка «Счётчики») и «Передано».
 */
export function UtilityActions({
  utility,
  withOpen = true,
}: {
  utility: UtilityRow;
  withOpen?: boolean;
}) {
  const { action } = utility;
  let primary = null;
  if (action?.kind === 'enter_readings') {
    primary = utility.needsMeters ? (
      <>
        <p className="radar-hint">
          <Link to={`/home/${utility.objectId}/meters`}>{action.hint ?? 'Добавьте счётчики'}</Link>
        </p>
        {action.completionAction ? (
          <MarkReadingsButton
            occurrenceId={action.completionAction.occurrenceId}
            label={action.completionAction.label}
          />
        ) : null}
      </>
    ) : (
      <Link
        className="btn btn--primary btn--block"
        to={readingsPath(action.objectId ?? utility.objectId)}
      >
        {action.label || FALLBACK.enter_readings}
      </Link>
    );
  } else if (action?.kind === 'mark_payment' && action.occurrenceId) {
    primary = (
      <MarkPaymentButton
        occurrenceId={action.occurrenceId}
        label={action.label || FALLBACK.mark_payment}
      />
    );
  } else if (action?.kind === 'verify_meter' && action.meterId) {
    primary = (
      <VerifyButton meterId={action.meterId} label={action.label || FALLBACK.verify_meter} />
    );
  }
  return (
    <div className="radar-actions">
      {primary}
      {withOpen ? (
        <Link className="text-button radar-actions__open" to={utility.openTo}>
          {utility.openLabel}
        </Link>
      ) : null}
    </div>
  );
}
