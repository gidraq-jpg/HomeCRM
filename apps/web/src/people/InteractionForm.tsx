import { type FormEvent, useId, useState } from 'react';
import { Notice, type useAction } from '../auth/components.tsx';
import { ObjectError } from '../objects/components.tsx';
import { isStaleVersion } from '../objects/errors.ts';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { type InteractionInput, MAX_INTERACTION_TEXT } from './api.ts';
import {
  type CallAgainChoice,
  type InteractionDraft,
  type InteractionErrors,
  toInteractionInput,
} from './interaction-form.ts';
import { KIND_LABELS } from './labels.ts';

interface InteractionFormProps {
  draft: InteractionDraft;
  /** Объекты, которые видит участник: взаимодействие можно привязать к одному из них. */
  objects: readonly { id: string; title: string }[];
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (values: InteractionInput) => void;
  onCancel: () => void;
  /** Запись изменили, пока её правили: показать свежую версию, а введённое отбросить. */
  onReload?: () => void;
}

const KINDS = (Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((value) => ({
  value,
  label: KIND_LABELS[value],
}));

const CALL_AGAIN = [
  { value: 'unset', label: 'Не отмечено' },
  { value: 'yes', label: 'Да' },
  { value: 'no', label: 'Нет' },
] as const satisfies readonly { value: CallAgainChoice; label: string }[];

/**
 * Форма взаимодействия (CONT-4): вид, дата, текст, сумма в рублях, «звать снова» и объект. Сумма
 * хранится в копейках. Введённое живёт только в памяти страницы: в localStorage и адрес не попадает.
 */
export function InteractionForm({
  draft,
  objects,
  submitLabel,
  pendingLabel,
  state,
  onSubmit,
  onCancel,
  onReload,
}: InteractionFormProps) {
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<InteractionErrors>({});
  const ids = { date: useId(), text: useId(), amount: useId(), object: useId() };
  const set = (change: Partial<InteractionDraft>) =>
    setValues((previous) => ({ ...previous, ...change }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toInteractionInput(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = result.errors.occurredOn
        ? ids.date
        : result.errors.text
          ? ids.text
          : ids.amount;
      document.getElementById(first)?.focus();
      return;
    }
    setErrors({});
    onSubmit(result.value);
  }

  const stale = onReload !== undefined && isStaleVersion(state.error);

  return (
    <form className="event-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <span className="field__label" aria-hidden="true">
          Вид
        </span>
        <ChipGroup
          legend="Вид взаимодействия"
          value={values.kind}
          options={KINDS}
          onChange={(kind) => set({ kind })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.date}>
          Дата
        </label>
        <input
          id={ids.date}
          className="input"
          type="date"
          value={values.occurredOn}
          required
          aria-invalid={errors.occurredOn !== undefined}
          aria-describedby={errors.occurredOn ? `${ids.date}-error` : undefined}
          onChange={(event) => set({ occurredOn: event.target.value })}
        />
        {errors.occurredOn ? (
          <p className="field__error" id={`${ids.date}-error`} role="alert">
            {errors.occurredOn}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.text}>
          Что было
        </label>
        <textarea
          id={ids.text}
          className="textarea"
          value={values.text}
          maxLength={MAX_INTERACTION_TEXT}
          rows={4}
          required
          aria-invalid={errors.text !== undefined}
          aria-describedby={errors.text ? `${ids.text}-error` : undefined}
          onChange={(event) => set({ text: event.target.value })}
        />
        {errors.text ? (
          <p className="field__error" id={`${ids.text}-error`} role="alert">
            {errors.text}
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
          value={values.amount}
          autoComplete="off"
          aria-invalid={errors.amount !== undefined}
          aria-describedby={`${ids.amount}-hint`}
          onChange={(event) => set({ amount: event.target.value })}
        />
        <p
          className={errors.amount ? 'field__error' : 'field__hint'}
          id={`${ids.amount}-hint`}
          {...(errors.amount ? { role: 'alert' } : {})}
        >
          {errors.amount ?? 'В рублях, можно с копейками: 1 840,50.'}
        </p>
      </div>

      <div className="field">
        <span className="field__label" aria-hidden="true">
          Звать снова
        </span>
        <ChipGroup
          legend="Звать снова"
          value={values.callAgain}
          options={CALL_AGAIN}
          onChange={(callAgain) => set({ callAgain })}
        />
      </div>

      {objects.length > 0 ? (
        <div className="field">
          <label className="field__label" htmlFor={ids.object}>
            Объект (необязательно)
          </label>
          <select
            id={ids.object}
            className="select"
            value={values.objectId}
            onChange={(event) => set({ objectId: event.target.value })}
          >
            <option value="">Без объекта</option>
            {objects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.title}
              </option>
            ))}
          </select>
          <p className="field__hint">Запись появится и в ленте этого объекта.</p>
        </div>
      ) : null}

      {stale ? (
        <Notice error>
          <strong>Запись изменили, пока вы её правили.</strong>
          <p>«Обновить» покажет свежую версию, а то, что вы ввели, пропадёт.</p>
          <button type="button" className="btn btn--secondary" onClick={onReload}>
            Обновить
          </button>
        </Notice>
      ) : (
        <ObjectError error={state.error} action="interaction" />
      )}

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
