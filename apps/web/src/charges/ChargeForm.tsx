import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import type { AccountCard } from '../accounts/api.ts';
import type { useAction } from '../auth/components.tsx';
import type { ObjectCard } from '../objects/api.ts';
import type { DateOnly } from '../ui/format.ts';
import { formatRub, formatShortDate } from '../ui/format.ts';
import { useOperationKey } from '../ui/useOperationKey.ts';
import type { ChargeInput } from './api.ts';
import { ChargeError } from './components.tsx';
import {
  type ChargeDraft,
  type ChargeErrors,
  defaultDueOn,
  emptyChargeDraft,
  type LineDraft,
  linesTotal,
  MAX_LINE_TITLE,
  MAX_LINES,
  toChargeInput,
} from './form.ts';
import { ReceiptField } from './ReceiptField.tsx';

interface ChargeFormProps {
  card: Pick<ObjectCard, 'id' | 'files'>;
  account: Pick<AccountCard, 'data'>;
  /** Расчётный месяц по умолчанию: предыдущий. */
  period: string;
  today: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (input: ChargeInput) => void;
  onCancel: () => void;
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text === undefined ? null : (
    <p className="field__error" id={id} role="alert">
      {text}
    </p>
  );
}

/**
 * Форма начисления (UTIL-9): месяц, строки по услугам (необязательно), перерасчёт со знаком,
 * итог, срок оплаты и файл квитанции. Суммы — в рублях с запятой; при строках итог считается сам.
 */
export function ChargeForm({
  card,
  account,
  period,
  today,
  state,
  onSubmit,
  onCancel,
}: ChargeFormProps) {
  const [draft, setDraft] = useState<ChargeDraft>(() => emptyChargeDraft(period));
  const [errors, setErrors] = useState<ChargeErrors | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const base = useId();
  const keyOf = useOperationKey();
  const id = (name: string) => `${base}-${name}`;
  const set = (change: Partial<ChargeDraft>) =>
    setDraft((previous) => ({ ...previous, ...change }));

  const rule = account.data.paymentRule;
  const suggested = defaultDueOn(draft.period, rule);
  const total = linesTotal(draft.lines);

  function addLine(kind: LineDraft['kind']) {
    set({ lines: [...draft.lines, { key: nextKey, title: '', amount: '', kind }] });
    setNextKey(nextKey + 1);
  }

  function changeLine(key: number, change: Partial<LineDraft>) {
    set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...change } : line)) });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toChargeInput(draft, rule);
    if (!result.ok) {
      setErrors(result.errors);
      const first =
        result.errors.period !== undefined
          ? id('period')
          : result.errors.total !== undefined
            ? id('total')
            : Object.keys(result.errors.lines).length > 0
              ? id(`line-${Object.keys(result.errors.lines)[0]}`)
              : id('due');
      document.getElementById(first)?.focus();
      return;
    }
    setErrors(null);
    onSubmit({ ...result.input, idempotencyKey: keyOf(result.input) });
  }

  return (
    <form className="charge-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={id('period')}>
          Расчётный месяц
        </label>
        <input
          id={id('period')}
          className="input"
          type="month"
          value={draft.period}
          aria-invalid={errors?.period !== undefined}
          aria-describedby={errors?.period === undefined ? undefined : id('period-error')}
          onChange={(event) => set({ period: event.target.value })}
        />
        <FieldError id={id('period-error')} text={errors?.period} />
      </div>

      {draft.lines.map((line, index) => (
        <fieldset className="charge-line" key={line.key}>
          <legend className="field__label">
            {line.kind === 'adjustment' ? 'Перерасчёт' : 'Строка'} {index + 1}
          </legend>
          <div className="field">
            <label className="field__label" htmlFor={id(`line-${line.key}`)}>
              Название
            </label>
            <input
              id={id(`line-${line.key}`)}
              className="input"
              type="text"
              maxLength={MAX_LINE_TITLE}
              placeholder={
                line.kind === 'adjustment'
                  ? 'Например, корректировка за воду'
                  : 'Например, холодная вода'
              }
              value={line.title}
              aria-invalid={errors?.lines[line.key]?.title !== undefined}
              onChange={(event) => changeLine(line.key, { title: event.target.value })}
            />
            <FieldError
              id={id(`line-${line.key}-title-error`)}
              text={errors?.lines[line.key]?.title}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={id(`amount-${line.key}`)}>
              {line.kind === 'adjustment' ? 'Сумма со знаком, ₽' : 'Сумма, ₽'}
            </label>
            <input
              id={id(`amount-${line.key}`)}
              className="input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1 840,50"
              value={line.amount}
              aria-invalid={errors?.lines[line.key]?.amount !== undefined}
              onChange={(event) => changeLine(line.key, { amount: event.target.value })}
            />
            {line.kind === 'adjustment' ? (
              <p className="field__hint">
                Со знаком «минус» сумма уменьшает итог: например, «-120,00» — вернули часть платы.
              </p>
            ) : null}
            <FieldError
              id={id(`amount-${line.key}-error`)}
              text={errors?.lines[line.key]?.amount}
            />
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => set({ lines: draft.lines.filter((item) => item.key !== line.key) })}
          >
            <Trash size={20} aria-hidden />
            Убрать {line.kind === 'adjustment' ? 'перерасчёт' : 'строку'} {index + 1}
          </button>
        </fieldset>
      ))}

      {draft.lines.length < MAX_LINES ? (
        <div className="btn-row">
          <button type="button" className="btn btn--secondary" onClick={() => addLine('service')}>
            <Plus size={20} aria-hidden />
            Добавить строку
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => addLine('adjustment')}
          >
            <Plus size={20} aria-hidden />
            Добавить перерасчёт
          </button>
        </div>
      ) : null}

      {draft.lines.length === 0 ? (
        <div className="field">
          <label className="field__label" htmlFor={id('total')}>
            Итог, ₽
          </label>
          <input
            id={id('total')}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1 840,50"
            value={draft.total}
            aria-invalid={errors?.total !== undefined}
            aria-describedby={errors?.total === undefined ? undefined : id('total-error')}
            onChange={(event) => set({ total: event.target.value })}
          />
          <p className="field__hint">Строки по услугам необязательны: достаточно итога.</p>
          <FieldError id={id('total-error')} text={errors?.total} />
        </div>
      ) : (
        <div className="field" id={id('total')} tabIndex={-1}>
          <p className="field__label">Итог</p>
          <p className="charge-total" aria-live="polite">
            {total === null ? 'Заполните суммы строк' : formatRub(total)}
          </p>
          <FieldError id={id('total-error')} text={errors?.total} />
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor={id('due')}>
          Срок оплаты
        </label>
        <input
          id={id('due')}
          className="input"
          type="date"
          value={draft.dueOn}
          aria-invalid={errors?.dueOn !== undefined}
          aria-describedby={id('due-hint')}
          onChange={(event) => set({ dueOn: event.target.value })}
        />
        <p className="field__hint" id={id('due-hint')}>
          {suggested === null
            ? 'У лицевого счёта нет ежемесячного дня оплаты, поэтому срок нужно указать.'
            : `Если не указывать, срок будет ${formatShortDate(suggested as DateOnly, today as DateOnly)}: день оплаты из лицевого счёта.`}
        </p>
        <FieldError id={id('due-error')} text={errors?.dueOn} />
      </div>

      <ReceiptField
        card={card}
        label="Квитанция"
        value={draft.receiptId}
        onChange={(receiptId) => set({ receiptId })}
      />

      <ChargeError error={state.error} action="charge" />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? 'Сохраняем…' : 'Сохранить начисление'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
