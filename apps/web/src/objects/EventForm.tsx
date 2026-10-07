import { type FormEvent, useId, useState } from 'react';
import type { useAction } from '../auth/components.tsx';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { type EventInput, MAX_EVENT_TEXT } from './api.ts';
import { ObjectError } from './components.tsx';
import { kopecksToInput, parseRubles } from './money.ts';

export interface EventDraft {
  occurredOn: string;
  text: string;
  amountKopecks: number | null;
  rating: number | null;
}

interface EventFormProps {
  draft: EventDraft;
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (values: EventInput) => void;
  onCancel: () => void;
}

const RATINGS = [
  { value: '', label: 'Без оценки' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
] as const;

/**
 * Форма ручного события ленты: дата, текст, сумма в рублях, оценка. Сумма хранится в копейках.
 * Введённое живёт только в памяти страницы: в localStorage и адрес оно не попадает.
 */
export function EventForm({
  draft,
  submitLabel,
  pendingLabel,
  state,
  onSubmit,
  onCancel,
}: EventFormProps) {
  const [occurredOn, setOccurredOn] = useState(draft.occurredOn);
  const [text, setText] = useState(draft.text);
  const [amount, setAmount] = useState(
    draft.amountKopecks === null ? '' : kopecksToInput(draft.amountKopecks),
  );
  const [rating, setRating] = useState(draft.rating === null ? '' : String(draft.rating));
  const [touched, setTouched] = useState(false);
  const ids = { date: useId(), text: useId(), amount: useId() };

  const parsed = parseRubles(amount);
  const dateMissing = touched && occurredOn === '';
  const textMissing = touched && text.trim() === '';
  const amountInvalid = touched && !parsed.ok;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (occurredOn === '') return document.getElementById(ids.date)?.focus();
    if (text.trim() === '') return document.getElementById(ids.text)?.focus();
    if (!parsed.ok) return document.getElementById(ids.amount)?.focus();
    onSubmit({
      occurredOn,
      text: text.trim(),
      amountKopecks: parsed.kopecks,
      rating: rating === '' ? null : Number(rating),
    });
  }

  return (
    <form className="event-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.date}>
          Дата
        </label>
        <input
          id={ids.date}
          className="input"
          type="date"
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
          required
          aria-invalid={dateMissing}
          aria-describedby={dateMissing ? `${ids.date}-error` : undefined}
        />
        {dateMissing ? (
          <p className="field__error" id={`${ids.date}-error`} role="alert">
            Укажите дату события.
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.text}>
          Что произошло
        </label>
        <textarea
          id={ids.text}
          className="textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_EVENT_TEXT}
          rows={4}
          required
          aria-invalid={textMissing}
          aria-describedby={textMissing ? `${ids.text}-error` : undefined}
        />
        {textMissing ? (
          <p className="field__error" id={`${ids.text}-error`} role="alert">
            Опишите событие: без текста его не сохранить.
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.amount}>
          Сумма, ₽ (необязательно)
        </label>
        <input
          id={ids.amount}
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoComplete="off"
          aria-invalid={amountInvalid}
          aria-describedby={`${ids.amount}-hint`}
        />
        <p
          className={amountInvalid ? 'field__error' : 'field__hint'}
          id={`${ids.amount}-hint`}
          {...(amountInvalid ? { role: 'alert' } : {})}
        >
          {amountInvalid
            ? 'Введите сумму числом: 3500 или 1 840,50. Не больше двух знаков после запятой.'
            : 'В рублях, можно с копейками: 1 840,50. Возврат — со знаком «минус».'}
        </p>
      </div>

      <div className="field">
        <span className="field__label" aria-hidden="true">
          Оценка
        </span>
        <ChipGroup
          legend="Оценка от 1 до 5"
          value={rating}
          options={RATINGS}
          onChange={setRating}
        />
      </div>

      <ObjectError error={state.error} action="event" />

      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? pendingLabel : submitLabel}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
