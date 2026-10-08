import { type FormEvent, useId, useState } from 'react';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import type { ObjectCard } from '../objects/api.ts';
import { Sheet } from '../ui/Sheet.tsx';
import type { PaymentInput, PaymentMethod } from './api.ts';
import { ChargeError } from './components.tsx';
import {
  type PaymentDraft,
  type PaymentErrors,
  paymentDraft,
  reasonOf,
  toPaymentInput,
} from './form.ts';
import { METHOD_LABELS, METHOD_ORDER } from './labels.ts';
import { ReceiptField } from './ReceiptField.tsx';

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text === undefined ? null : (
    <p className="field__error" id={id} role="alert">
      {text}
    </p>
  );
}

interface PaymentSheetProps {
  card: Pick<ObjectCard, 'id' | 'files' | 'spaceKind'>;
  remainingCents: number;
  today: string;
  onSubmit: (input: PaymentInput) => Promise<void>;
  onClose: () => void;
}

/**
 * Оплата начисления (UTIL-10): дата, сумма (по умолчанию остаток), кто заплатил, способ и чек.
 * Сумма, дата, плательщик и способ после сохранения не меняются: ошибочную оплату отменяют.
 */
export function PaymentSheet({
  card,
  remainingCents,
  today,
  onSubmit,
  onClose,
}: PaymentSheetProps) {
  const { me } = useHousehold();
  const members = useMembers();
  const state = useAction();
  const [draft, setDraft] = useState<PaymentDraft>(() => paymentDraft(today, remainingCents));
  const [methodTouched, setMethodTouched] = useState(false);
  const [errors, setErrors] = useState<PaymentErrors | null>(null);
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const set = (change: Partial<PaymentDraft>) =>
    setDraft((previous) => ({ ...previous, ...change }));

  // В личном объекте плательщик — сам участник или арендатор; в общем — любой действующий участник дома.
  const others =
    card.spaceKind === 'household'
      ? (members.data ?? []).filter((member) => !member.formerMember && member.accountId !== me.id)
      : [];

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = toPaymentInput(draft, me.id, today);
    if (!result.ok) {
      setErrors(result.errors);
      document
        .getElementById(result.errors.paidOn === undefined ? id('amount') : id('date'))
        ?.focus();
      return;
    }
    setErrors(null);
    void state.run(async () => {
      await onSubmit(result.input);
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Оплата"
      description="Сумма, дата, плательщик и способ после сохранения не меняются: ошибочную оплату можно отменить с причиной."
    >
      <form className="sheet__block" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={id('date')}>
            Дата оплаты
          </label>
          <input
            id={id('date')}
            className="input"
            type="date"
            max={today}
            value={draft.paidOn}
            aria-invalid={errors?.paidOn !== undefined}
            onChange={(event) => set({ paidOn: event.target.value })}
          />
          <FieldError id={id('date-error')} text={errors?.paidOn} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id('amount')}>
            Сумма, ₽
          </label>
          <input
            id={id('amount')}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.amount}
            aria-invalid={errors?.amount !== undefined}
            onChange={(event) => set({ amount: event.target.value })}
          />
          <p className="field__hint">По умолчанию — остаток начисления. Переплата разрешена.</p>
          <FieldError id={id('amount-error')} text={errors?.amount} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id('payer')}>
            Кто заплатил
          </label>
          <select
            id={id('payer')}
            className="select"
            value={draft.payer}
            onChange={(event) => {
              const payer = event.target.value;
              set({
                payer,
                ...(payer === 'tenant' && !methodTouched
                  ? { method: 'tenant' as PaymentMethod }
                  : {}),
                ...(payer !== 'tenant' && !methodTouched
                  ? { method: 'card' as PaymentMethod }
                  : {}),
              });
            }}
          >
            <option value="me">Я</option>
            {others.map((member) => (
              <option key={member.accountId} value={`member:${member.accountId}`}>
                {member.displayName}
              </option>
            ))}
            <option value="tenant">Арендатор</option>
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id('method')}>
            Способ оплаты
          </label>
          <select
            id={id('method')}
            className="select"
            value={draft.method}
            onChange={(event) => {
              setMethodTouched(true);
              set({ method: event.target.value as PaymentMethod });
            }}
          >
            {METHOD_ORDER.map((method) => (
              <option key={method} value={method}>
                {METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </div>
        <ReceiptField
          card={card}
          label="Чек"
          value={draft.receiptId}
          onChange={(receiptId) => set({ receiptId })}
        />
        <ChargeError error={state.error} action="payment" />
        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={state.disabled}>
            {state.pending ? 'Сохраняем…' : 'Сохранить оплату'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Sheet>
  );
}

interface CancelSheetProps {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  action: 'cancel-charge' | 'cancel-payment';
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** Отмена денежной записи: причина обязательна и остаётся в истории. Удаления нет. */
export function CancelSheet({
  title,
  description,
  confirmLabel,
  pendingLabel,
  action,
  onSubmit,
  onClose,
}: CancelSheetProps) {
  const state = useAction();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = reasonOf(reason);
    if (!result.ok) {
      setProblem(result.error);
      document.getElementById(fieldId)?.focus();
      return;
    }
    setProblem(null);
    void state.run(async () => {
      await onSubmit(result.reason);
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
    >
      <form className="sheet__block" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={fieldId}>
            Причина
          </label>
          <textarea
            id={fieldId}
            className="textarea"
            maxLength={2000}
            value={reason}
            aria-invalid={problem !== null}
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldError id={`${fieldId}-error`} text={problem ?? undefined} />
        </div>
        <ChargeError error={state.error} action={action} />
        <div className="btn-row">
          <button type="submit" className="btn btn--danger" disabled={state.disabled}>
            {state.pending ? pendingLabel : confirmLabel}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Не отменять
          </button>
        </div>
      </form>
    </Sheet>
  );
}
