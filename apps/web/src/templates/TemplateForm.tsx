import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { defaultObjectVisibility, type Visibility } from '../access/visibility.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { showDecimal } from '../meters/decimal.ts';
import { viewerOf } from '../notes/abilities.ts';
import { creatableObjectVisibilities } from '../objects/abilities.ts';
import { todayIn } from '../objects/dates.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import { countWord } from '../ui/format.ts';
import { applyTemplate, TAX_REGIMES, type TaxRegime, type Template } from './api.ts';
import { templateErrorMessage } from './errors.ts';
import {
  buildRequest,
  type FormErrors,
  initialSelection,
  MAX_ADDRESS,
  MAX_TITLE,
  METER_UNITS,
  newKey,
  type Selection,
  type SelectionGroup,
  selectedCount,
  toggled,
} from './form.ts';

const itemCount = (count: number) => countWord(count, ['пункт', 'пункта', 'пунктов']);

interface TemplateFormProps {
  template: Template;
  /** Объект создан: родитель переходит дальше. */
  onCreated: (objectId: string) => Promise<void> | void;
  submitLabel?: string;
  /** Кнопка «Пропустить» мастера первого запуска. */
  onSkip?: (() => void) | undefined;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="template-group">
      <legend className="template-group__legend">{title}</legend>
      {hint ? <p className="field__hint template-group__hint">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/**
 * Список пунктов шаблона с галочками по группам (TPL-2, TPL-3): счета, счётчики с начальным
 * показанием, организации, повторяющиеся сроки и налоговый режим. «Кто видит» стоит над кнопкой.
 * Создаётся всё одним действием; повтор безопасен благодаря ключу идемпотентности.
 */
export function TemplateForm({
  template,
  onCreated,
  submitLabel = 'Создать',
  onSkip,
}: TemplateFormProps) {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const state = useAction();
  const today = todayIn(me.timeZone);
  const options = creatableObjectVisibilities(viewerOf(me), householdId);
  const [selection, setSelection] = useState<Selection>(() => initialSelection(template));
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [readingDate, setReadingDate] = useState<string>(today);
  const [visibility, setVisibility] = useState<Visibility>(() => {
    const wanted = defaultObjectVisibility('property', scope);
    return options.includes(wanted) ? wanted : 'personal';
  });
  const [errors, setErrors] = useState<FormErrors | null>(null);
  // Ключ живёт, пока форма не меняется: повтор после потери ответа не создаёт второй объект,
  // а правка формы берёт новый ключ, чтобы сервер не принял её за другой запрос с тем же ключом.
  const key = useRef<string | null>(null);
  const base = useId();
  const id = (name: string) => `${base}-${name}`;

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      key.current = null;
      setter(value);
    };
  }
  const toggle = (group: SelectionGroup, itemId: string) => {
    key.current = null;
    setSelection((previous) => toggled(previous, group, itemId));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildRequest(
      template,
      selection,
      { title, address, readings, readingDate },
      { me, householdId, visibility },
      today,
    );
    if (!built.ok) {
      setErrors(built.errors);
      const firstReading = Object.keys(built.errors.readings)[0];
      const target =
        built.errors.title !== undefined
          ? id('title')
          : built.errors.address !== undefined
            ? id('address')
            : built.errors.readingDate !== undefined
              ? id('reading-date')
              : firstReading !== undefined
                ? id(`reading-${firstReading}`)
                : null;
      if (target !== null) document.getElementById(target)?.focus();
      return;
    }
    setErrors(null);
    key.current ??= newKey();
    const request = { idempotencyKey: key.current, ...built.request };
    void state.run(async () => {
      const created = await applyTemplate(template.id, request);
      await onCreated(created.objectId);
    });
  }

  const anyMeter = template.meters.some((meter) => selection.meters.has(meter.id));
  const accountTitles = new Map(template.accounts.map((account) => [account.id, account.title]));
  const regimes = template.taxRegimes;

  return (
    <form className="template-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <p className="muted">
        Шаблон предлагает, а не навязывает: лишние галочки снимите, остальное создастся одним
        действием. Выбрано: {itemCount(selectedCount(selection))}.
      </p>

      <div className="field">
        <label className="field__label" htmlFor={id('title')}>
          Название объекта
        </label>
        <input
          id={id('title')}
          className="input"
          type="text"
          maxLength={MAX_TITLE}
          autoComplete="off"
          value={title}
          aria-invalid={errors?.title !== undefined}
          aria-describedby={errors?.title === undefined ? undefined : id('title-error')}
          onChange={(event) => change(setTitle)(event.target.value)}
        />
        {errors?.title === undefined ? null : (
          <p className="field__error" id={id('title-error')} role="alert">
            {errors.title}
          </p>
        )}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={id('address')}>
          Адрес
        </label>
        <input
          id={id('address')}
          className="input"
          type="text"
          maxLength={MAX_ADDRESS}
          autoComplete="off"
          value={address}
          aria-invalid={errors?.address !== undefined}
          aria-describedby={errors?.address === undefined ? undefined : id('address-error')}
          onChange={(event) => change(setAddress)(event.target.value)}
        />
        {errors?.address === undefined ? null : (
          <p className="field__error" id={id('address-error')} role="alert">
            {errors.address}
          </p>
        )}
      </div>

      {template.accounts.length > 0 ? (
        <Group
          title="Лицевые счета"
          hint="Номера и поставщиков можно добавить позже на вкладке «Счета»."
        >
          {template.accounts.map((account) => (
            <CheckLine
              key={account.id}
              checked={selection.accounts.has(account.id)}
              onChange={() => toggle('accounts', account.id)}
            >
              {account.title}
            </CheckLine>
          ))}
        </Group>
      ) : null}

      {template.meters.length > 0 ? (
        <Group
          title="Счётчики"
          hint="Начальное показание необязательно: достаточно последнего. Прошлые месяцы вводить не нужно."
        >
          {template.meters.map((meter) => {
            const checked = selection.meters.has(meter.id);
            const accountOff = checked && !selection.accounts.has(meter.accountId);
            const problem = errors?.readings[meter.id];
            return (
              <div className="template-meter" key={meter.id}>
                <CheckLine checked={checked} onChange={() => toggle('meters', meter.id)}>
                  {meter.title}
                </CheckLine>
                {checked ? (
                  <div className="template-meter__reading">
                    <label className="field__label" htmlFor={id(`reading-${meter.id}`)}>
                      Начальное показание: {meter.title}, {METER_UNITS[meter.id] ?? ''}
                    </label>
                    <input
                      id={id(`reading-${meter.id}`)}
                      className="input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={`например, ${showDecimal('123.456')}`}
                      value={readings[meter.id] ?? ''}
                      aria-invalid={problem !== undefined}
                      aria-describedby={
                        problem === undefined ? undefined : id(`reading-${meter.id}-error`)
                      }
                      onChange={(event) =>
                        change((value: string) =>
                          setReadings((previous) => ({ ...previous, [meter.id]: value })),
                        )(event.target.value)
                      }
                    />
                    {problem === undefined ? null : (
                      <p className="field__error" id={id(`reading-${meter.id}-error`)} role="alert">
                        {problem}
                      </p>
                    )}
                    {accountOff ? (
                      <p className="field__hint">
                        Счёт «{accountTitles.get(meter.accountId) ?? ''}» снят: счётчик создастся
                        без связи со счётом.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {anyMeter ? (
            <div className="field">
              <label className="field__label" htmlFor={id('reading-date')}>
                Дата начальных показаний
              </label>
              <input
                id={id('reading-date')}
                className="input"
                type="date"
                max={today}
                value={readingDate}
                aria-invalid={errors?.readingDate !== undefined}
                onChange={(event) => change(setReadingDate)(event.target.value)}
              />
              {errors?.readingDate === undefined ? null : (
                <p className="field__error" role="alert">
                  {errors.readingDate}
                </p>
              )}
            </div>
          ) : null}
        </Group>
      ) : null}

      {template.organizations.length > 0 ? (
        <Group
          title="Организации"
          hint="Заготовки без телефонов: контакты добавите сами. Видит вся семья."
        >
          {template.organizations.map((organization) => (
            <CheckLine
              key={organization.id}
              checked={selection.organizations.has(organization.id)}
              onChange={() => toggle('organizations', organization.id)}
            >
              {organization.title}
            </CheckLine>
          ))}
        </Group>
      ) : null}

      {template.deadlines.length > 0 ? (
        <Group
          title="Повторяющиеся сроки"
          hint="Появятся в радаре. Даты и предупреждения меняются в карточке объекта."
        >
          {template.deadlines.map((deadline) => (
            <CheckLine
              key={deadline.id}
              checked={selection.deadlines.has(deadline.id)}
              onChange={() => toggle('deadlines', deadline.id)}
            >
              {deadline.title}
            </CheckLine>
          ))}
        </Group>
      ) : null}

      {regimes.length > 0 ? (
        <fieldset className="template-group">
          <legend className="template-group__legend">Налоговый режим</legend>
          <p className="field__hint template-group__hint">
            Выберите режим, и приложение заведёт налоговые сроки. Если не уверены, выберите позже.
          </p>
          {[
            {
              id: '' as const,
              title: 'Не выбирать сейчас',
              deadlines: [] as { id: string; title: string }[],
            },
            ...regimes,
          ].map((regime) => (
            <label className="choice" key={regime.id || 'none'}>
              <input
                type="radio"
                name={id('regime')}
                value={regime.id}
                checked={selection.taxRegime === regime.id}
                onChange={() => {
                  key.current = null;
                  setSelection((previous) => ({
                    ...previous,
                    taxRegime: (TAX_REGIMES as readonly string[]).includes(regime.id)
                      ? (regime.id as TaxRegime)
                      : '',
                  }));
                }}
              />
              <span className="choice__body">
                <span className="choice__title">{regime.title}</span>
                {regime.deadlines.length > 0 ? (
                  <span className="choice__hint">
                    {regime.deadlines.map((deadline) => deadline.title).join('; ')}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <VisibilityPicker
        value={visibility}
        options={options}
        onChange={change((next: Visibility) => setVisibility(next))}
      />
      {options.length === 1 ? (
        <p className="muted">
          {householdId === null
            ? 'Вы не состоите в доме, поэтому объект будет личным.'
            : 'Общие объекты создают взрослые. Вам доступны только личные: их видите только вы.'}
        </p>
      ) : null}

      {state.error ? <Notice error>{templateErrorMessage(state.error)}</Notice> : null}
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? 'Создаём…' : submitLabel}
        </button>
        {onSkip ? (
          <button type="button" className="btn btn--secondary" onClick={onSkip}>
            Пропустить
          </button>
        ) : null}
      </div>
    </form>
  );
}
