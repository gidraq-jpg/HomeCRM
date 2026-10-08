import { Plus } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import type { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ObjectError } from '../objects/components.tsx';
import { todayIn } from '../objects/dates.ts';
import type { ContactCard } from '../organizations/api.ts';
import { CreateOrganization } from '../organizations/CreateOrganization.tsx';
import { useOrganizationOptions } from '../organizations/queries.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { type AccountCard, MAX_TITLE } from './api.ts';
import {
  type AccountDraft,
  type AccountErrors,
  accountDraft,
  emptyAccountDraft,
  MAX_NOTE,
  MAX_NUMBER,
  MAX_PHONE,
  toAccountInput,
  toggleService,
} from './form.ts';
import {
  PAYER_LABELS,
  PAYERS,
  type Payer,
  SERVICE_LABELS,
  SERVICES,
  TRANSMISSION_LABELS,
  TRANSMISSION_METHODS,
  type TransmissionMethod,
} from './labels.ts';

export interface AccountValues {
  title: string;
  data: AccountCard['data'];
  /** Выбранный поставщик: пусто — «не указан» (скрытый поставщик остаётся как есть). */
  supplierId: string;
}

interface AccountFormProps {
  /** Счёт при правке; при создании его нет. */
  card?: AccountCard;
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (values: AccountValues) => void;
  onCancel: () => void;
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text === undefined ? null : (
    <p className="field__error" id={id} role="alert">
      {text}
    </p>
  );
}

const ORDER: (keyof AccountErrors)[] = [
  'title',
  'number',
  'providerUrl',
  'phone',
  'readFrom',
  'readTo',
  'payDay',
  'cabinetUrl',
  'note',
];

/**
 * Форма лицевого счёта: поставщик из организаций (и «Новая организация» прямо отсюда), услуги из
 * закрытого списка, номер, способ передачи показаний, окно «с 20 по 25», день оплаты, кто платит,
 * личный кабинет и заметка. Обязательного нет. Скрытый поставщик форма не стирает.
 */
export function AccountForm({
  card,
  submitLabel,
  pendingLabel,
  state,
  onSubmit,
  onCancel,
}: AccountFormProps) {
  const { me } = useHousehold();
  const [draft, setDraft] = useState<AccountDraft>(() =>
    card ? accountDraft(card) : emptyAccountDraft(),
  );
  const [errors, setErrors] = useState<AccountErrors | null>(null);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<ContactCard[]>([]);
  const organizations = useOrganizationOptions();
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const set = (change: Partial<AccountDraft>) =>
    setDraft((previous) => ({ ...previous, ...change }));

  // Поставщик в корзине в список живых организаций не входит, но у счёта он ещё назначен.
  const known = new Map<string, string>();
  for (const item of organizations.data ?? []) known.set(item.id, item.title);
  for (const item of created) known.set(item.id, item.title);
  const trashedSupplier =
    card?.supplier && !known.has(card.supplier.id)
      ? { id: card.supplier.id, title: `${card.supplier.title} (в корзине)` }
      : null;
  const supplierOptions = [
    ...(trashedSupplier ? [trashedSupplier] : []),
    ...[...known].map(([value, title]) => ({ id: value, title })),
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toAccountInput(draft, card?.data ?? null, todayIn(me.timeZone));
    if (!result.ok) {
      setErrors(result.errors);
      const first = ORDER.find((key) => result.errors[key] !== undefined);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    setErrors(null);
    onSubmit({ title: result.title, data: result.data, supplierId: draft.supplierId });
  }

  const described = (name: keyof AccountErrors) =>
    errors?.[name] === undefined ? undefined : id(`${name}-error`);

  return (
    <>
      <form className="account-form" onSubmit={submit} aria-busy={state.pending} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={id('title')}>
            Название (необязательно)
          </label>
          <input
            id={id('title')}
            className="input"
            value={draft.title}
            maxLength={MAX_TITLE}
            autoComplete="off"
            aria-invalid={errors?.title !== undefined}
            aria-describedby={described('title') ?? id('title-hint')}
            onChange={(event) => set({ title: event.target.value })}
          />
          <FieldError id={id('title-error')} text={errors?.title} />
          <p className="field__hint" id={id('title-hint')}>
            Если оставить пустым, название возьмётся из услуг, например «Электроэнергия».
          </p>
        </div>

        <fieldset className="field-edit account-form__services">
          <legend className="field__label">Услуги</legend>
          {SERVICES.map((service) => (
            <CheckLine
              key={service}
              checked={draft.services.includes(service)}
              onChange={(on) => set({ services: toggleService(draft.services, service, on) })}
            >
              {SERVICE_LABELS[service]}
            </CheckLine>
          ))}
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor={id('supplier')}>
            Поставщик
          </label>
          <select
            id={id('supplier')}
            className="select"
            value={draft.supplierId}
            aria-describedby={id('supplier-hint')}
            onChange={(event) => set({ supplierId: event.target.value })}
          >
            <option value="">Не указан</option>
            {supplierOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <p className="field__hint" id={id('supplier-hint')}>
            {organizations.isPending
              ? 'Загружаем организации…'
              : card && card.supplier === null
                ? 'Если поставщик скрыт от вас, форма его не изменит, пока вы не выберете другого.'
                : 'Организации ведутся в разделе «Ещё → Организации».'}
          </p>
          {organizations.isError ? <ObjectError error={organizations.error} action="load" /> : null}
          <button
            type="button"
            className="btn btn--secondary btn--block account-form__new"
            onClick={() => setAdding(true)}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Новая организация
          </button>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={id('number')}>
            Номер лицевого счёта
          </label>
          <input
            id={id('number')}
            className="input"
            value={draft.number}
            maxLength={MAX_NUMBER}
            autoComplete="off"
            aria-invalid={errors?.number !== undefined}
            aria-describedby={described('number')}
            onChange={(event) => set({ number: event.target.value })}
          />
          <FieldError id={id('number-error')} text={errors?.number} />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={id('method')}>
            Способ передачи показаний
          </label>
          <select
            id={id('method')}
            className="select"
            value={draft.method}
            onChange={(event) => set({ method: event.target.value as TransmissionMethod | '' })}
          >
            <option value="">Не указан</option>
            {TRANSMISSION_METHODS.map((method) => (
              <option key={method} value={method}>
                {TRANSMISSION_LABELS[method]}
              </option>
            ))}
          </select>
        </div>

        {draft.method === 'provider' ? (
          <div className="field">
            <label className="field__label" htmlFor={id('providerUrl')}>
              Ссылка на сайт или приложение поставщика
            </label>
            <input
              id={id('providerUrl')}
              className="input"
              inputMode="url"
              value={draft.providerUrl}
              autoComplete="off"
              aria-invalid={errors?.providerUrl !== undefined}
              aria-describedby={described('providerUrl')}
              onChange={(event) => set({ providerUrl: event.target.value })}
            />
            <FieldError id={id('providerUrl-error')} text={errors?.providerUrl} />
          </div>
        ) : null}
        {draft.method === 'phone' ? (
          <div className="field">
            <label className="field__label" htmlFor={id('phone')}>
              Телефон для передачи показаний
            </label>
            <input
              id={id('phone')}
              className="input"
              type="tel"
              inputMode="tel"
              value={draft.phone}
              maxLength={MAX_PHONE}
              autoComplete="off"
              aria-invalid={errors?.phone !== undefined}
              aria-describedby={described('phone')}
              onChange={(event) => set({ phone: event.target.value })}
            />
            <FieldError id={id('phone-error')} text={errors?.phone} />
          </div>
        ) : null}

        <fieldset className="field-edit">
          <legend className="field__label">Окно передачи показаний</legend>
          <div className="account-form__days">
            <div className="field">
              <label className="field__label" htmlFor={id('readFrom')}>
                С числа
              </label>
              <input
                id={id('readFrom')}
                className="input"
                inputMode="numeric"
                maxLength={2}
                value={draft.readFrom}
                autoComplete="off"
                aria-invalid={errors?.readFrom !== undefined}
                aria-describedby={described('readFrom') ?? id('window-hint')}
                onChange={(event) => set({ readFrom: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={id('readTo')}>
                По число
              </label>
              <input
                id={id('readTo')}
                className="input"
                inputMode="numeric"
                maxLength={2}
                value={draft.readTo}
                autoComplete="off"
                aria-invalid={errors?.readTo !== undefined}
                aria-describedby={described('readTo') ?? id('window-hint')}
                onChange={(event) => set({ readTo: event.target.value })}
              />
            </div>
          </div>
          <FieldError id={id('readFrom-error')} text={errors?.readFrom} />
          <FieldError id={id('readTo-error')} text={errors?.readTo} />
          <p className="field__hint" id={id('window-hint')}>
            Например, с 20 по 25. Если окно переходит на следующий месяц, укажите с 28 по 5.
          </p>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor={id('payDay')}>
            День оплаты
          </label>
          <input
            id={id('payDay')}
            className="input"
            inputMode="numeric"
            maxLength={2}
            value={draft.payDay}
            autoComplete="off"
            aria-invalid={errors?.payDay !== undefined}
            aria-describedby={described('payDay') ?? id('payDay-hint')}
            onChange={(event) => set({ payDay: event.target.value })}
          />
          <FieldError id={id('payDay-error')} text={errors?.payDay} />
          <p className="field__hint" id={id('payDay-hint')}>
            Число месяца, например 15.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={id('payer')}>
            Кто платит
          </label>
          <select
            id={id('payer')}
            className="select"
            value={draft.payer}
            onChange={(event) => set({ payer: event.target.value as Payer })}
          >
            {PAYERS.map((payer) => (
              <option key={payer} value={payer}>
                {PAYER_LABELS[payer]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={id('cabinetUrl')}>
            Ссылка на личный кабинет
          </label>
          <input
            id={id('cabinetUrl')}
            className="input"
            inputMode="url"
            value={draft.cabinetUrl}
            autoComplete="off"
            aria-invalid={errors?.cabinetUrl !== undefined}
            aria-describedby={described('cabinetUrl')}
            onChange={(event) => set({ cabinetUrl: event.target.value })}
          />
          <FieldError id={id('cabinetUrl-error')} text={errors?.cabinetUrl} />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={id('note')}>
            Заметка
          </label>
          <textarea
            id={id('note')}
            className="textarea"
            value={draft.note}
            maxLength={MAX_NOTE}
            aria-invalid={errors?.note !== undefined}
            aria-describedby={described('note')}
            onChange={(event) => set({ note: event.target.value })}
          />
          <FieldError id={id('note-error')} text={errors?.note} />
        </div>

        <ObjectError error={state.error} action="account" />
        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={state.disabled}>
            {state.pending ? pendingLabel : submitLabel}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>

      {/* Панель стоит вне формы: события вложенной формы всплывают через портал к внешней. */}
      {adding ? (
        <Sheet
          open
          onOpenChange={(next) => {
            if (!next) setAdding(false);
          }}
          title="Новая организация"
          description="Организация сохранится и сразу станет поставщиком этого счёта. Обязательно только название."
        >
          <CreateOrganization
            onCancel={() => setAdding(false)}
            onCreated={(organization) => {
              setCreated((previous) => [...previous, organization]);
              set({ supplierId: organization.id });
              setAdding(false);
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}
