import type { ReceiptAccount, ReceiptPhotoDraft } from '@homecrm/shared';
import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useId, useRef, useState } from 'react';
import type { AccountCard } from '../accounts/api.ts';
import type { useAction } from '../auth/components.tsx';
import { uploadFile } from '../files/api.ts';
import { prepareForUpload } from '../files/prepare.ts';
import type { ObjectCard } from '../objects/api.ts';
import { useObjectCard } from '../objects/queries.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
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
  kopecksToInput,
  type LineDraft,
  linesTotal,
  MAX_LINE_TITLE,
  MAX_LINES,
  toChargeInput,
} from './form.ts';
import { ReceiptCapture } from './ReceiptCapture.tsx';
import { ReceiptField } from './ReceiptField.tsx';

interface ChargeFormProps {
  card: Pick<ObjectCard, 'id' | 'files'>;
  account: Pick<AccountCard, 'id' | 'title' | 'data'>;
  /** Расчётный месяц по умолчанию: предыдущий. */
  period: string;
  today: string;
  state: ReturnType<typeof useAction>;
  initial?: ReceiptPhotoDraft;
  onSubmit: (input: ChargeInput, accountId: string, objectId: string) => Promise<void>;
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
  initial,
  onSubmit,
  onCancel,
}: ChargeFormProps) {
  const [draft, setDraft] = useState<ChargeDraft>(() =>
    initial
      ? {
          ...emptyChargeDraft(initial.period.value ?? period),
          total: initial.totalCents.value === null ? '' : kopecksToInput(initial.totalCents.value),
          dueOn: initial.dueOn.value ?? '',
        }
      : emptyChargeDraft(period),
  );
  const [errors, setErrors] = useState<ChargeErrors | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const [candidates, setCandidates] = useState<ReceiptAccount[]>([]);
  const [targetId, setTargetId] = useState(account.id);
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [photoProblem, setPhotoProblem] = useState('');
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<string | null>(null);
  const uploaded = useRef<{ file: File; objectId: string; id: string } | null>(null);
  const saving = useRef(false);
  const target = candidates.find((item) => item.id === targetId);
  const targetObjectId = target?.objectId ?? card.id;
  const targetCard = useObjectCard(targetObjectId !== card.id ? targetObjectId : undefined);
  const receiptCard = targetObjectId === card.id ? card : targetCard.data;
  const base = useId();
  const keyOf = useOperationKey();
  const id = (name: string) => `${base}-${name}`;
  const set = (change: Partial<ChargeDraft>) => {
    setDraft((previous) => ({ ...previous, ...change }));
    setUncertain((current) =>
      current.filter(
        (key) =>
          !(key === 'totalCents' && change.total !== undefined) &&
          !(key === 'period' && change.period !== undefined) &&
          !(key === 'dueOn' && change.dueOn !== undefined),
      ),
    );
  };

  const rule = (target ?? account).data.paymentRule;
  const suggested = defaultDueOn(draft.period, rule);
  const total = linesTotal(draft.lines);

  function addLine(kind: LineDraft['kind']) {
    set({ lines: [...draft.lines, { key: nextKey, title: '', amount: '', kind }] });
    setNextKey(nextKey + 1);
  }

  function changeLine(key: number, change: Partial<LineDraft>) {
    set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...change } : line)) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !targetId || !receiptCard) return;
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
    saving.current = true;
    setPreparing(true);
    setPhotoProblem('');
    try {
      let receiptId = result.input.receiptId;
      if (photo && keepPhoto) {
        let known = uploaded.current;
        if (known?.file !== photo || known.objectId !== targetObjectId) {
          const prepared = await prepareForUpload(photo);
          const file = await uploadFile({ kind: 'object', id: targetObjectId }, prepared);
          known = { file: photo, objectId: targetObjectId, id: file.id };
          uploaded.current = known;
        }
        receiptId = known.id;
      }
      const body = { ...result.input, receiptId };
      await onSubmit(
        { ...body, idempotencyKey: keyOf({ ...body, accountId: targetId }) },
        targetId,
        targetObjectId,
      );
    } catch {
      setPhotoProblem('Не удалось приложить фото. Поля сохранены; повторите сохранение.');
    } finally {
      saving.current = false;
      setPreparing(false);
    }
  }

  function fromReceipt(result: ReceiptPhotoDraft, file: File, accounts: ReceiptAccount[]) {
    setCandidates(accounts);
    setTargetId(
      accounts.some((account) => account.id === result.accountId.value)
        ? (result.accountId.value ?? '')
        : '',
    );
    setPhoto(file);
    setKeepPhoto(false);
    uploaded.current = null;
    set({
      period: result.period.value ?? draft.period,
      total:
        result.totalCents.value === null ? draft.total : kopecksToInput(result.totalCents.value),
      dueOn: result.dueOn.value ?? '',
      lines: [],
      receiptId: '',
    });
    setUncertain(
      Object.entries(result)
        .filter(([, field]) => !field.confident || field.value === null)
        .map(([key]) => key),
    );
    setSupplier(result.supplier.value);
  }

  return (
    <form className="charge-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <ReceiptCapture
        onDraft={fromReceipt}
        disabled={preparing || state.disabled}
        onPending={setReadingReceipt}
      />
      {photo ? (
        <>
          {supplier ? <p>Поставщик из квитанции: {supplier}</p> : null}
          <label className="field">
            <span>Счёт из квитанции{uncertain.includes('accountId') ? ' — проверьте' : ''}</span>
            <select
              className="select"
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
                set({ receiptId: '' });
                setUncertain((current) => current.filter((key) => key !== 'accountId'));
              }}
            >
              <option value="">Выберите лицевой счёт</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.data.number} · {item.objectTitle}
                </option>
              ))}
            </select>
          </label>
          {target ? (
            <p>
              Сохранится для объекта «{target.objectTitle}», счёт «{target.title}».
            </p>
          ) : null}
          <CheckLine checked={keepPhoto} onChange={setKeepPhoto}>
            Приложить фото квитанции
          </CheckLine>
        </>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor={id('period')}>
          Расчётный месяц{uncertain.includes('period') ? ' — проверьте' : ''}
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
            Итог, ₽{uncertain.includes('totalCents') ? ' — проверьте' : ''}
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
          Срок оплаты{uncertain.includes('dueOn') ? ' — проверьте' : ''}
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

      {receiptCard ? (
        <ReceiptField
          key={targetObjectId}
          card={receiptCard}
          label="Квитанция"
          value={draft.receiptId}
          onChange={(receiptId) => set({ receiptId })}
        />
      ) : (
        <p role="status">Загружаем объект выбранного счёта…</p>
      )}
      {photoProblem ? <p role="alert">{photoProblem}</p> : null}

      <ChargeError error={state.error} action="charge" />
      <div className="btn-row">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={state.disabled || preparing || readingReceipt || !targetId || !receiptCard}
        >
          {state.pending || preparing ? 'Сохраняем…' : 'Сохранить начисление'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={preparing || state.pending}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
