import { type FormEvent, useId, useState } from 'react';
import type { AccountCard } from '../accounts/api.ts';
import { useAccounts } from '../accounts/queries.ts';
import { type useAction as UseAction, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ObjectError } from '../objects/components.tsx';
import { todayIn } from '../objects/dates.ts';
import { formatShortDate } from '../ui/format.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  type MeterCard,
  type MeterInput,
  type MeterListItem,
  type patchMeter,
  replaceMeter,
} from './api.ts';
import { checkZone, problemText, showDecimal } from './decimal.ts';
import {
  emptyMeterDraft,
  type MeterDraft,
  type MeterErrors,
  meterDraft,
  toMeterInput,
  toMeterPatch,
} from './form.ts';
import { RESOURCE_UNITS, STATE_LABELS } from './labels.ts';
import { Field, fieldId, firstErrorId, MeterFields } from './MeterFields.tsx';
import { useRefreshMeters } from './queries.ts';

type Action = ReturnType<typeof UseAction>;

function focusField(id: string | null) {
  if (id !== null) document.getElementById(id)?.focus();
}

interface CommonProps {
  accounts: readonly AccountCard[];
  state: Action;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
}

/** Новый счётчик (UTIL-3) с необязательным начальным показанием (UTIL-14). */
export function CreateMeterForm({
  accounts,
  state,
  submitLabel,
  pendingLabel,
  onCancel,
  onSubmit,
}: CommonProps & { onSubmit: (input: MeterInput) => void }) {
  const { me } = useHousehold();
  const base = useId();
  const [draft, setDraft] = useState<MeterDraft>(() => emptyMeterDraft(todayIn(me.timeZone)));
  const [errors, setErrors] = useState<MeterErrors | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toMeterInput(draft, { initialRequired: false, structureLocked: false });
    if (!result.ok) {
      setErrors(result.errors);
      focusField(firstErrorId(base, result.errors));
      return;
    }
    setErrors(null);
    onSubmit(result.input);
  }

  return (
    <form className="meter-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <MeterFields
        base={base}
        draft={draft}
        onChange={setDraft}
        errors={errors}
        accounts={accounts}
        initial={{
          heading: 'Начальное показание',
          hint: 'Достаточно последнего показания: с квитанции или со счётчика. История прошлых месяцев не нужна. Можно пропустить и ввести позже.',
          dateLabel: 'Дата показания',
        }}
      />
      <ObjectError error={state.error} action="meter" />
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

/** Правка счётчика: ресурс, зоны и разрядность не меняются, если показания уже есть. */
export function EditMeterForm({
  card,
  hasReadings,
  accounts,
  state,
  submitLabel,
  pendingLabel,
  onCancel,
  onSubmit,
}: CommonProps & {
  card: MeterCard;
  hasReadings: boolean;
  onSubmit: (patch: {
    title: string;
    utilityAccountId: string | null;
    data: NonNullable<Parameters<typeof patchMeter>[1]['data']>;
  }) => void;
}) {
  const { me } = useHousehold();
  const base = useId();
  const [draft, setDraft] = useState<MeterDraft>(() => meterDraft(card, todayIn(me.timeZone)));
  const [errors, setErrors] = useState<MeterErrors | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toMeterPatch(draft, card);
    if (!result.ok) {
      setErrors(result.errors);
      focusField(firstErrorId(base, result.errors));
      return;
    }
    setErrors(null);
    onSubmit({ title: result.title, utilityAccountId: result.utilityAccountId, data: result.data });
  }

  return (
    <form className="meter-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <MeterFields
        base={base}
        draft={draft}
        onChange={setDraft}
        errors={errors}
        accounts={accounts}
        structureLocked={hasReadings}
        initial={null}
      />
      <Field id={fieldId(base, 'status')} label="Состояние">
        <select
          id={fieldId(base, 'status')}
          className="select"
          value={draft.status}
          onChange={(event) =>
            setDraft({ ...draft, status: event.target.value === 'removed' ? 'removed' : 'active' })
          }
        >
          <option value="active">{STATE_LABELS.active}</option>
          <option value="removed">{STATE_LABELS.removed}: ввод показаний закрыт</option>
        </select>
      </Field>
      <ObjectError error={state.error} action="meter" />
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

interface ReplaceFormProps {
  old: MeterListItem;
  accounts: readonly AccountCard[];
  /** Подсказка для начального показания нового счётчика, если оно уже введено (экран «Показания»). */
  suggestedInitial?: string;
  onDone: () => void;
  onCancel: () => void;
}

/** Замена счётчика (UTIL-6): конечное показание старого, данные и начальное показание нового. */
function ReplaceForm({ old, accounts, suggestedInitial, onDone, onCancel }: ReplaceFormProps) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshMeters();
  const base = useId();
  const state = useAction();
  const today = todayIn(me.timeZone);
  const previous = old.previousReading;
  const digits = { integerDigits: old.data.integerDigits, fractionDigits: old.data.fractionDigits };
  const unit = old.data.unit ?? RESOURCE_UNITS[old.data.resource];

  const [date, setDate] = useState<string>(today);
  const [finals, setFinals] = useState<string[]>(() => old.data.zones.map(() => ''));
  const [draft, setDraft] = useState<MeterDraft>(() => {
    const start = meterDraft({ ...old, title: '' }, today);
    return {
      ...start,
      title: '',
      serialNumber: '',
      model: '',
      installedOn: today,
      verifiedOn: '',
      verificationYears: '',
      nextVerificationOn: '',
      nextManual: false,
      status: 'active',
      initialDate: today,
      initialValues: suggestedInitial === undefined ? ['', '', ''] : [suggestedInitial, '', ''],
    };
  });
  const [errors, setErrors] = useState<MeterErrors | null>(null);
  const [finalErrors, setFinalErrors] = useState<(string | undefined)[] | null>(null);
  const [dateError, setDateError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: (string | undefined)[] = [];
    const values: string[] = [];
    old.data.zones.forEach((zone, index) => {
      const before = previous?.values[index] ?? null;
      const checked = checkZone(digits, finals[index] ?? '', before, false);
      if (checked.status === 'ok') {
        values.push(checked.value);
        problems.push(undefined);
      } else if (checked.status === 'empty') {
        problems.push(
          old.data.zones.length === 1
            ? 'Введите конечное показание старого счётчика.'
            : `Введите значение для зоны «${zone}».`,
        );
      } else {
        problems.push(problemText(checked.problem, digits));
      }
    });
    let dateProblem: string | undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) dateProblem = 'Укажите дату замены полностью.';
    else if (previous !== null && date < previous.occurredOn) {
      dateProblem = `Дата замены не может быть раньше прошлого показания (${formatShortDate(previous.occurredOn as `${number}-${number}-${number}`, today as `${number}-${number}-${number}`)}).`;
    }
    const result = toMeterInput(
      { ...draft, initialDate: date },
      { initialRequired: true, structureLocked: false },
    );
    const finalBad = problems.some((problem) => problem !== undefined);
    setFinalErrors(finalBad ? problems : null);
    setDateError(dateProblem);
    if (!result.ok) setErrors(result.errors);
    else setErrors(null);
    if (finalBad || dateProblem !== undefined || !result.ok) {
      if (dateProblem !== undefined) focusField(fieldId(base, 'date'));
      else if (finalBad)
        focusField(fieldId(base, `final-${problems.findIndex((p) => p !== undefined) + 1}`));
      else if (!result.ok) focusField(firstErrorId(base, result.errors));
      return;
    }
    if (!result.ok || result.input.initialReading === undefined) return;
    const newMeter = { ...result.input, initialReading: result.input.initialReading };
    void state.run(async () => {
      await replaceMeter(old.id, { finalReading: { occurredOn: date, values }, newMeter });
      await refresh();
      toast.show({
        message: 'Счётчик заменён',
        detail: 'История не прервалась: расход старого и нового счётчиков считается отдельно.',
      });
      onDone();
    });
  }

  const dateId = fieldId(base, 'date');
  return (
    <form className="meter-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <p className="muted">
        Старый счётчик: <strong>{old.title}</strong>
        {previous === null
          ? ''
          : `. Прошлое показание: ${previous.values.map(showDecimal).join(' · ')} ${unit}.`}
      </p>
      <Field id={dateId} label="Дата замены" error={dateError}>
        <input
          id={dateId}
          className="input"
          type="date"
          value={date}
          aria-invalid={dateError !== undefined}
          aria-describedby={dateError === undefined ? undefined : `${dateId}-error`}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>

      <fieldset className="field-edit">
        <legend className="field__label">Конечное показание старого счётчика</legend>
        {old.data.zones.map((zone, index) => {
          const finalId = fieldId(base, `final-${index + 1}`);
          const error = finalErrors?.[index];
          return (
            <Field
              key={finalId}
              id={finalId}
              label={old.data.zones.length === 1 ? `Показание, ${unit}` : `${zone}, ${unit}`}
              error={error}
            >
              <input
                id={finalId}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                value={finals[index] ?? ''}
                aria-invalid={error !== undefined}
                aria-describedby={error === undefined ? undefined : `${finalId}-error`}
                onChange={(event) => {
                  const next = [...finals];
                  next[index] = event.target.value;
                  setFinals(next);
                }}
              />
            </Field>
          );
        })}
      </fieldset>

      <h3 className="meter-form__heading">Новый счётчик</h3>
      <MeterFields
        base={base}
        draft={draft}
        onChange={setDraft}
        errors={errors}
        accounts={accounts}
        resourceLocked
        initial={{
          heading: 'Начальное показание нового счётчика',
          hint: 'С цифр на новом счётчике в день замены. Расход между старым и новым не считается.',
          dateLabel: 'Дата замены',
        }}
        hideInitialDate
      />
      <ObjectError error={state.error} action="replace" />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? 'Заменяем…' : 'Заменить счётчик'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/** Замена в нижней панели: её открывают и с вкладки «Счётчики», и с экрана «Показания». */
export function ReplaceSheet({
  objectId,
  old,
  suggestedInitial,
  onDone,
  onClose,
}: {
  objectId: string;
  old: MeterListItem;
  suggestedInitial?: string;
  /** Замена прошла: например, очистить введённое значение на экране «Показания». */
  onDone?: () => void;
  onClose: () => void;
}) {
  const accounts = useAccounts(objectId).data ?? [];
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Замена счётчика"
      description="Введите конечное показание старого счётчика и данные нового с его первым показанием. Если что-то не получится, ничего не сохранится."
    >
      <ReplaceForm
        old={old}
        accounts={accounts}
        {...(suggestedInitial === undefined ? {} : { suggestedInitial })}
        onDone={() => {
          onDone?.();
          onClose();
        }}
        onCancel={onClose}
      />
    </Sheet>
  );
}
