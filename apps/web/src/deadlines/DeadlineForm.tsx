import type { DeadlineRule } from '@homecrm/shared';
import { type FormEvent, useId, useState } from 'react';
import type { useAction } from '../auth/components.tsx';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { countWord } from '../ui/format.ts';
import { DeadlineError } from './components.tsx';
import {
  type AfterUnit,
  type Draft,
  type DraftField,
  type RepeatUnit,
  type RuleKind,
  ruleFromDraft,
} from './form.ts';
import { KIND_LABELS } from './labels.ts';

/** Предупреждения «за N дней», которые предлагаются сразу; остальные добавляются числом. */
const PRESET_WARNINGS = [1, 3, 7, 14, 30] as const;

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as RuleKind[]).map((value) => ({
  value,
  label: KIND_LABELS[value],
}));
const REPEAT_OPTIONS: readonly { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'Дни' },
  { value: 'month', label: 'Месяцы' },
  { value: 'year', label: 'Годы' },
];
const AFTER_OPTIONS: readonly { value: AfterUnit; label: string }[] = [
  { value: 'day', label: 'Дни' },
  { value: 'month', label: 'Месяцы' },
];
const EVERY_LABELS: Readonly<Record<RepeatUnit, string>> = {
  day: 'Каждые, дней',
  month: 'Каждые, месяцев',
  year: 'Каждые, лет',
};

interface DeadlineFormProps {
  draft: Draft;
  today: string;
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  action: 'create' | 'save';
  onSubmit: (rule: DeadlineRule) => void;
  onCancel: () => void;
}

/**
 * Форма срока (DEAD-1): вид правила, его поля и предупреждения за N дней. Введённое живёт только
 * в памяти страницы: в localStorage, адрес и журнал оно не попадает.
 */
export function DeadlineForm({
  draft: initial,
  today,
  submitLabel,
  pendingLabel,
  state,
  action,
  onSubmit,
  onCancel,
}: DeadlineFormProps) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<{ field: DraftField; message: string } | null>(null);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState(false);
  const base = useId();
  const fieldId = (field: DraftField) => `${base}-${field}`;
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const invalid = (field: DraftField) => problem?.field === field;

  function setKind(kind: RuleKind) {
    setProblem(null);
    // «После события» начинается без даты: она появится, когда событие случится.
    if (kind === 'after' && draft.kind !== 'after' && draft.date === today) {
      change({ kind, date: '' });
    } else if (kind !== 'after' && draft.kind === 'after' && draft.date === '') {
      change({ kind, date: today });
    } else {
      change({ kind });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = ruleFromDraft(draft);
    if (!result.ok) {
      setProblem({ field: result.field, message: result.message });
      document.getElementById(fieldId(result.field))?.focus();
      return;
    }
    setProblem(null);
    onSubmit(result.rule);
  }

  function toggleWarning(days: number) {
    change({
      warnings: draft.warnings.includes(days)
        ? draft.warnings.filter((value) => value !== days)
        : [...draft.warnings, days].sort((a, b) => b - a),
    });
  }

  function addCustom() {
    const days = /^\d{1,3}$/.test(custom.trim()) ? Number(custom.trim()) : null;
    if (days === null || days > 365) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    setCustom('');
    if (!draft.warnings.includes(days))
      change({ warnings: [...draft.warnings, days].sort((a, b) => b - a) });
  }

  const message = (field: DraftField) =>
    invalid(field) ? (
      <p className="field__error" id={`${fieldId(field)}-error`} role="alert">
        {problem?.message}
      </p>
    ) : null;
  const describedBy = (field: DraftField) =>
    invalid(field) ? `${fieldId(field)}-error` : undefined;

  const dateField = (label: string, field: 'date' | 'endDate', hint?: string) => (
    <div className="field">
      <label className="field__label" htmlFor={fieldId(field)}>
        {label}
      </label>
      <input
        id={fieldId(field)}
        className="input"
        type="date"
        value={draft[field]}
        onChange={(event) => change({ [field]: event.target.value })}
        aria-invalid={invalid(field)}
        aria-describedby={describedBy(field)}
      />
      {hint && !invalid(field) ? <p className="field__hint">{hint}</p> : null}
      {message(field)}
    </div>
  );
  const timeField = (label: string, field: 'time' | 'endTime') => (
    <div className="field">
      <label className="field__label" htmlFor={fieldId(field)}>
        {label}
      </label>
      <input
        id={fieldId(field)}
        className="input"
        type="time"
        value={draft[field]}
        onChange={(event) => change({ [field]: event.target.value })}
        aria-invalid={invalid(field)}
        aria-describedby={describedBy(field)}
      />
      {message(field)}
    </div>
  );
  const numberField = (
    label: string,
    field: 'every' | 'monthDay' | 'durationDays',
    hint?: string,
  ) => (
    <div className="field">
      <label className="field__label" htmlFor={fieldId(field)}>
        {label}
      </label>
      <input
        id={fieldId(field)}
        className="input"
        inputMode="numeric"
        autoComplete="off"
        value={draft[field]}
        onChange={(event) => change({ [field]: event.target.value })}
        aria-invalid={invalid(field)}
        aria-describedby={describedBy(field)}
      />
      {hint && !invalid(field) ? <p className="field__hint">{hint}</p> : null}
      {message(field)}
    </div>
  );

  const extra = draft.warnings.filter(
    (days) => !(PRESET_WARNINGS as readonly number[]).includes(days),
  );
  const warningChoices = [...new Set([...PRESET_WARNINGS, ...extra])].sort((a, b) => a - b);

  return (
    <form className="deadline-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <span className="field__label" aria-hidden="true">
          Вид срока
        </span>
        <ChipGroup
          legend="Вид срока"
          value={draft.kind}
          options={KIND_OPTIONS}
          onChange={setKind}
        />
      </div>

      {draft.kind === 'date' ? (
        <>
          {dateField('Дата', 'date')}
          {timeField('Время (необязательно)', 'time')}
        </>
      ) : null}

      {draft.kind === 'window' ? (
        <>
          {dateField('Начало, дата', 'date')}
          {timeField('Начало, время', 'time')}
          {dateField('Конец, дата', 'endDate')}
          {timeField('Конец, время', 'endTime')}
        </>
      ) : null}

      {draft.kind === 'repeat' ? (
        <>
          <div className="field">
            <span className="field__label" aria-hidden="true">
              Повторять по
            </span>
            <ChipGroup
              legend="Повторять по"
              value={draft.repeatUnit}
              options={REPEAT_OPTIONS}
              onChange={(repeatUnit) => change({ repeatUnit })}
            />
          </div>
          {numberField(EVERY_LABELS[draft.repeatUnit], 'every')}
          {draft.repeatUnit === 'month' ? numberField('День месяца', 'monthDay') : null}
          {draft.repeatUnit === 'year' ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor={fieldId('month')}>
                  Месяц
                </label>
                <select
                  id={fieldId('month')}
                  className="select"
                  value={draft.month}
                  onChange={(event) => change({ month: event.target.value })}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={MONTH_NAMES[index]} value={String(index + 1)}>
                      {monthName(index + 1)}
                    </option>
                  ))}
                </select>
              </div>
              {numberField('День', 'monthDay')}
            </>
          ) : null}
          {dateField('Начиная с', 'date')}
          {timeField('Время начала (необязательно)', 'time')}
          {numberField(
            'Длится ещё, дней',
            'durationDays',
            '0 — срок на один день. 5 — окно из шести дней, например с 20 по 25 число.',
          )}
        </>
      ) : null}

      {draft.kind === 'after' ? (
        <>
          {numberField('Через сколько', 'every')}
          <div className="field">
            <span className="field__label" aria-hidden="true">
              Считать в
            </span>
            <ChipGroup
              legend="Считать в"
              value={draft.afterUnit}
              options={AFTER_OPTIONS}
              onChange={(afterUnit) => change({ afterUnit })}
            />
          </div>
          {dateField(
            'Дата события (необязательно)',
            'date',
            'Можно оставить пустой: срок появится, когда вы укажете дату события.',
          )}
          {timeField('Время (необязательно)', 'time')}
        </>
      ) : null}

      <fieldset className="field deadline-warnings">
        <legend className="field__label">Предупредить заранее</legend>
        <div className="chip-group">
          {warningChoices.map((days) => (
            <label className="chip" key={days}>
              <input
                type="checkbox"
                checked={draft.warnings.includes(days)}
                onChange={() => toggleWarning(days)}
              />
              <span className="chip__label">{warningLabel(days)}</span>
            </label>
          ))}
        </div>
        <div className="deadline-warnings__custom">
          <label className="field__label" htmlFor={`${base}-custom`}>
            Другое число дней
          </label>
          <div className="deadline-warnings__row">
            <input
              id={`${base}-custom`}
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={custom}
              aria-invalid={customError}
              aria-describedby={customError ? `${base}-custom-error` : undefined}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addCustom();
              }}
            />
            <button type="button" className="btn btn--secondary" onClick={addCustom}>
              Добавить
            </button>
          </div>
          {customError ? (
            <p className="field__error" id={`${base}-custom-error`} role="alert">
              Введите число дней от 0 до 365.
            </p>
          ) : null}
        </div>
      </fieldset>

      <DeadlineError error={state.error} action={action} />

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

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/** Подпись переключателя предупреждения: «за 7 дней»; 0 — «в день срока». */
function warningLabel(days: number): string {
  return days === 0 ? 'в день срока' : `за ${countWord(days, ['день', 'дня', 'дней'])}`;
}
