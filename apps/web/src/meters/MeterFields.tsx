import type { ReactNode } from 'react';
import type { AccountCard } from '../accounts/api.ts';
import { countWord, formatFullDate, type PluralForms } from '../ui/format.ts';
import {
  computedNextVerification,
  type MeterDraft,
  type MeterErrors,
  withZoneCount,
  type ZoneCount,
} from './form.ts';
import {
  defaultVerificationYears,
  type MeterResource,
  RESOURCE_LABELS,
  RESOURCE_UNITS,
  RESOURCES,
  ZONE_COUNT_LABELS,
} from './labels.ts';

// Общие поля счётчика: создание, правка и новый счётчик при замене (UTIL-3, UTIL-6, UTIL-14).

const YEARS: PluralForms = ['год', 'года', 'лет'];

export const fieldId = (base: string, name: string) => `${base}-${name}`;

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
}

/** Подпись, поле, подсказка и ошибка; ошибка читается вместе с полем. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error === undefined ? null : (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {hint === undefined ? null : (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error: string | undefined, hint: boolean) =>
  error === undefined ? (hint ? `${id}-hint` : undefined) : `${id}-error`;

interface MeterFieldsProps {
  base: string;
  draft: MeterDraft;
  onChange: (next: MeterDraft) => void;
  errors: MeterErrors | null;
  accounts: readonly AccountCard[];
  /** Ресурс, зоны и разрядность не меняются: показания уже есть. */
  structureLocked?: boolean;
  /** Ресурс нельзя выбрать (замена: новый счётчик того же ресурса). */
  resourceLocked?: boolean;
  /** Блок начального показания; `null` — не показывать. */
  initial: { heading: string; hint: string; dateLabel: string } | null;
  /** Дата начального показания введена выше (замена: одна дата на оба показания). */
  hideInitialDate?: boolean;
}

export function MeterFields({
  base,
  draft,
  onChange,
  errors,
  accounts,
  structureLocked = false,
  resourceLocked = false,
  initial,
  hideInitialDate = false,
}: MeterFieldsProps) {
  const id = (name: string) => fieldId(base, name);
  const set = (change: Partial<MeterDraft>) => onChange({ ...draft, ...change });
  const unit = RESOURCE_UNITS[draft.resource];
  const computed = computedNextVerification(
    draft.resource,
    draft.verifiedOn,
    draft.verificationYears,
  );
  const zoneNames = draft.zones.slice(0, draft.zoneCount);
  const lockStructure = structureLocked;

  return (
    <>
      <Field id={id('resource')} label="Ресурс">
        <select
          id={id('resource')}
          className="select"
          value={draft.resource}
          disabled={lockStructure || resourceLocked}
          onChange={(event) => set({ resource: event.target.value as MeterResource })}
        >
          {RESOURCES.map((resource) => (
            <option key={resource} value={resource}>
              {RESOURCE_LABELS[resource]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={id('place')}
        label="Место установки"
        error={errors?.place}
        hint="Например, «Санузел» или «Кухня»: по месту счётчик узнают при вводе показаний."
      >
        <input
          id={id('place')}
          className="input"
          value={draft.place}
          autoComplete="off"
          aria-invalid={errors?.place !== undefined}
          aria-describedby={describedBy(id('place'), errors?.place, true)}
          onChange={(event) => set({ place: event.target.value })}
        />
      </Field>

      <Field id={id('serial')} label="Заводской номер" error={errors?.serialNumber}>
        <input
          id={id('serial')}
          className="input"
          value={draft.serialNumber}
          autoComplete="off"
          aria-invalid={errors?.serialNumber !== undefined}
          aria-describedby={describedBy(id('serial'), errors?.serialNumber, false)}
          onChange={(event) => set({ serialNumber: event.target.value })}
        />
      </Field>

      <Field id={id('model')} label="Модель" error={errors?.model}>
        <input
          id={id('model')}
          className="input"
          value={draft.model}
          autoComplete="off"
          aria-invalid={errors?.model !== undefined}
          aria-describedby={describedBy(id('model'), errors?.model, false)}
          onChange={(event) => set({ model: event.target.value })}
        />
      </Field>

      <Field
        id={id('title')}
        label="Название (необязательно)"
        error={errors?.title}
        hint="Если оставить пустым, название составится из ресурса и места: «ХВС, санузел»."
      >
        <input
          id={id('title')}
          className="input"
          value={draft.title}
          autoComplete="off"
          aria-invalid={errors?.title !== undefined}
          aria-describedby={describedBy(id('title'), errors?.title, true)}
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <Field
        id={id('account')}
        label="Лицевой счёт"
        hint={
          accounts.length === 0
            ? 'Лицевых счетов у объекта пока нет. Счётчик можно связать с ними позже.'
            : 'По лицевым счетам собираются значения для передачи.'
        }
      >
        <select
          id={id('account')}
          className="select"
          value={draft.utilityAccountId}
          aria-describedby={`${id('account')}-hint`}
          onChange={(event) => set({ utilityAccountId: event.target.value })}
        >
          <option value="">Не указан</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.title}
              {account.data.number === '' ? '' : `, ${account.data.number}`}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={id('zones')}
        label="Тарифность"
        hint={
          lockStructure
            ? 'Зоны и разрядность после первого показания не меняются: для другого прибора служит замена счётчика.'
            : undefined
        }
      >
        <select
          id={id('zones')}
          className="select"
          value={draft.zoneCount}
          disabled={lockStructure}
          onChange={(event) =>
            onChange(withZoneCount(draft, Number(event.target.value) as ZoneCount))
          }
        >
          {([1, 2, 3] as const).map((count) => (
            <option key={count} value={count}>
              {ZONE_COUNT_LABELS[count]}
            </option>
          ))}
        </select>
      </Field>

      {draft.zoneCount > 1
        ? zoneNames.map((zone, index) => {
            const zoneId = id(`zone-${index + 1}`);
            const error = errors?.zones?.[index];
            return (
              <Field key={zoneId} id={zoneId} label={`Название зоны ${index + 1}`} error={error}>
                <input
                  id={zoneId}
                  className="input"
                  value={zone}
                  disabled={lockStructure}
                  autoComplete="off"
                  aria-invalid={error !== undefined}
                  aria-describedby={describedBy(zoneId, error, false)}
                  onChange={(event) => {
                    const zones = [...draft.zones] as MeterDraft['zones'];
                    zones[index] = event.target.value;
                    set({ zones });
                  }}
                />
              </Field>
            );
          })
        : null}

      <div className="meter-form__digits">
        <Field id={id('integer')} label="Цифр до запятой" error={errors?.integerDigits}>
          <input
            id={id('integer')}
            className="input"
            inputMode="numeric"
            maxLength={2}
            value={draft.integerDigits}
            disabled={lockStructure}
            autoComplete="off"
            aria-invalid={errors?.integerDigits !== undefined}
            aria-describedby={describedBy(id('integer'), errors?.integerDigits, false)}
            onChange={(event) => set({ integerDigits: event.target.value })}
          />
        </Field>
        <Field id={id('fraction')} label="Цифр после запятой" error={errors?.fractionDigits}>
          <input
            id={id('fraction')}
            className="input"
            inputMode="numeric"
            maxLength={1}
            value={draft.fractionDigits}
            disabled={lockStructure}
            autoComplete="off"
            aria-invalid={errors?.fractionDigits !== undefined}
            aria-describedby={describedBy(id('fraction'), errors?.fractionDigits, false)}
            onChange={(event) => set({ fractionDigits: event.target.value })}
          />
        </Field>
      </div>
      <p className="field__hint">Единица измерения: {unit}.</p>

      <Field id={id('installed')} label="Дата установки" error={errors?.installedOn}>
        <input
          id={id('installed')}
          className="input"
          type="date"
          value={draft.installedOn}
          aria-invalid={errors?.installedOn !== undefined}
          aria-describedby={describedBy(id('installed'), errors?.installedOn, false)}
          onChange={(event) => set({ installedOn: event.target.value })}
        />
      </Field>

      <Field id={id('verified')} label="Дата последней поверки" error={errors?.verifiedOn}>
        <input
          id={id('verified')}
          className="input"
          type="date"
          value={draft.verifiedOn}
          aria-invalid={errors?.verifiedOn !== undefined}
          aria-describedby={describedBy(id('verified'), errors?.verifiedOn, false)}
          onChange={(event) => set({ verifiedOn: event.target.value })}
        />
      </Field>

      <Field
        id={id('years')}
        label="Интервал поверки, лет"
        error={errors?.verificationYears}
        hint={`Если оставить пустым, возьмём типовой интервал: ${countWord(defaultVerificationYears(draft.resource), YEARS)}. Точное значение указано в паспорте прибора.`}
      >
        <input
          id={id('years')}
          className="input"
          inputMode="numeric"
          maxLength={2}
          value={draft.verificationYears}
          autoComplete="off"
          aria-invalid={errors?.verificationYears !== undefined}
          aria-describedby={describedBy(id('years'), errors?.verificationYears, true)}
          onChange={(event) => set({ verificationYears: event.target.value })}
        />
      </Field>

      <Field
        id={id('next')}
        label="Дата следующей поверки"
        error={errors?.nextVerificationOn}
        hint={
          computed === null
            ? 'Вычисляется из даты поверки и интервала. Можно указать вручную.'
            : `Вычислено: ${formatFullDate(computed as `${number}-${number}-${number}`)}. Можно поправить вручную.`
        }
      >
        <input
          id={id('next')}
          className="input"
          type="date"
          value={
            draft.nextManual || draft.nextVerificationOn !== ''
              ? draft.nextVerificationOn
              : (computed ?? '')
          }
          aria-invalid={errors?.nextVerificationOn !== undefined}
          aria-describedby={describedBy(id('next'), errors?.nextVerificationOn, true)}
          onChange={(event) => set({ nextVerificationOn: event.target.value, nextManual: true })}
        />
      </Field>

      {initial === null ? null : (
        <fieldset className="field-edit meter-form__initial">
          <legend className="field__label">{initial.heading}</legend>
          <p className="field__hint">{initial.hint}</p>
          {hideInitialDate ? null : (
            <Field id={id('initial-date')} label={initial.dateLabel} error={errors?.initialDate}>
              <input
                id={id('initial-date')}
                className="input"
                type="date"
                value={draft.initialDate}
                aria-invalid={errors?.initialDate !== undefined}
                aria-describedby={describedBy(id('initial-date'), errors?.initialDate, false)}
                onChange={(event) => set({ initialDate: event.target.value })}
              />
            </Field>
          )}
          {zoneNames.map((zone, index) => {
            const valueId = id(`initial-${index + 1}`);
            const error = errors?.initialValues?.[index];
            const label =
              draft.zoneCount === 1
                ? `Показание, ${unit}`
                : `${zone.trim() || `Зона ${index + 1}`}, ${unit}`;
            return (
              <Field key={valueId} id={valueId} label={label} error={error}>
                <input
                  id={valueId}
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  enterKeyHint="next"
                  value={draft.initialValues[index] ?? ''}
                  aria-invalid={error !== undefined}
                  aria-describedby={describedBy(valueId, error, false)}
                  onChange={(event) => {
                    const initialValues = [...draft.initialValues] as MeterDraft['initialValues'];
                    initialValues[index] = event.target.value;
                    set({ initialValues });
                  }}
                />
              </Field>
            );
          })}
        </fieldset>
      )}
    </>
  );
}

/** Порядок полей для перехода к первой ошибке. */
export function firstErrorId(base: string, errors: MeterErrors): string | null {
  const id = (name: string) => fieldId(base, name);
  const order: [boolean, string][] = [
    [errors.place !== undefined, id('place')],
    [errors.serialNumber !== undefined, id('serial')],
    [errors.model !== undefined, id('model')],
    [errors.title !== undefined, id('title')],
    [
      errors.zones?.some((zone) => zone !== undefined) === true,
      id(`zone-${(errors.zones?.findIndex((zone) => zone !== undefined) ?? 0) + 1}`),
    ],
    [errors.integerDigits !== undefined, id('integer')],
    [errors.fractionDigits !== undefined, id('fraction')],
    [errors.installedOn !== undefined, id('installed')],
    [errors.verifiedOn !== undefined, id('verified')],
    [errors.verificationYears !== undefined, id('years')],
    [errors.nextVerificationOn !== undefined, id('next')],
    [errors.initialDate !== undefined, id('initial-date')],
    [
      errors.initialValues?.some((value) => value !== undefined) === true,
      id(`initial-${(errors.initialValues?.findIndex((value) => value !== undefined) ?? 0) + 1}`),
    ],
  ];
  return order.find(([has]) => has)?.[1] ?? null;
}
