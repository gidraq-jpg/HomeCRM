import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import type { useAction } from '../auth/components.tsx';
import { ObjectError } from '../objects/components.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import {
  MAX_LABEL,
  MAX_NOTE,
  MAX_NUMBER,
  MAX_PHONES,
  MAX_TEXT,
  MAX_TITLE,
  type OrganizationInput,
  type OrganizationType,
} from './api.ts';
import {
  addPhone,
  ORGANIZATION_TYPE_LABELS,
  type OrganizationDraft,
  type OrganizationErrors,
  PHONE_LABEL_HINTS,
  removePhone,
  toOrganizationInput,
  updatePhone,
} from './form.ts';

interface VisibilityChoice {
  value: Visibility;
  options: readonly Visibility[];
  onChange: (value: Visibility) => void;
}

interface OrganizationFormProps {
  draft: OrganizationDraft;
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (values: OrganizationInput) => void;
  onCancel: () => void;
  /** Строка «Кто видит» над «Сохранить»: только при создании (PRD 7.4). */
  visibility?: VisibilityChoice;
  visibilityNote?: ReactNode;
}

const TYPES = Object.entries(ORGANIZATION_TYPE_LABELS) as [OrganizationType, string][];

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text === undefined ? null : (
    <p className="field__error" id={id} role="alert">
      {text}
    </p>
  );
}

/**
 * Форма организации: название, тип, телефоны с подписью и меткой «аварийный», сайт, адрес, часы
 * работы и заметка. Всё введённое живёт только в памяти страницы. Ошибки формата — у своего поля.
 */
export function OrganizationForm({
  draft,
  submitLabel,
  pendingLabel,
  state,
  onSubmit,
  onCancel,
  visibility,
  visibilityNote,
}: OrganizationFormProps) {
  const [title, setTitle] = useState(draft.title);
  const [organizationType, setOrganizationType] = useState(draft.organizationType);
  const [phones, setPhones] = useState(draft.phones);
  const [website, setWebsite] = useState(draft.website);
  const [address, setAddress] = useState(draft.address);
  const [openingHours, setOpeningHours] = useState(draft.openingHours);
  const [note, setNote] = useState(draft.note);
  const [errors, setErrors] = useState<OrganizationErrors | null>(null);
  const base = useId();
  const id = (name: string) => `${base}-${name}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toOrganizationInput({
      title,
      organizationType,
      phones,
      website,
      address,
      openingHours,
      note,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const first =
        result.errors.title !== undefined
          ? id('title')
          : Object.keys(result.errors.phones)[0] !== undefined
            ? `${id('phone')}-${Object.keys(result.errors.phones)[0]}`
            : result.errors.website !== undefined
              ? id('website')
              : result.errors.address !== undefined
                ? id('address')
                : result.errors.openingHours !== undefined
                  ? id('hours')
                  : id('note');
      document.getElementById(first)?.focus();
      return;
    }
    setErrors(null);
    onSubmit({ title: result.title, data: result.data });
  }

  const described = (name: string, text: string | undefined) =>
    text === undefined ? undefined : id(`${name}-error`);

  return (
    <form className="org-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={id('title')}>
          Название
        </label>
        <input
          id={id('title')}
          className="input"
          value={title}
          maxLength={MAX_TITLE}
          autoComplete="off"
          required
          aria-invalid={errors?.title !== undefined}
          aria-describedby={described('title', errors?.title)}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldError id={id('title-error')} text={errors?.title} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('type')}>
          Тип
        </label>
        <select
          id={id('type')}
          className="select"
          value={organizationType}
          onChange={(event) => setOrganizationType(event.target.value as OrganizationType)}
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field-edit">
        <legend className="field__label">Телефоны</legend>
        {phones.length === 0 ? (
          <p className="field__hint">
            Телефонов пока нет. Добавьте, например, диспетчера или аварийную службу.
          </p>
        ) : (
          <ul className="field-edit__list">
            {phones.map((phone, index) => {
              const error = errors?.phones[phone.key];
              const rowId = `${id('phone')}-${phone.key}`;
              return (
                <li className="phone-edit__item" key={phone.key}>
                  <div className="phone-edit__fields">
                    <input
                      id={rowId}
                      className="input"
                      type="tel"
                      inputMode="tel"
                      value={phone.number}
                      maxLength={MAX_NUMBER}
                      placeholder="Номер"
                      aria-label={`Телефон ${index + 1}: номер`}
                      autoComplete="off"
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : `${rowId}-error`}
                      onChange={(event) =>
                        setPhones(updatePhone(phones, phone.key, { number: event.target.value }))
                      }
                    />
                    <input
                      className="input"
                      value={phone.label}
                      maxLength={MAX_LABEL}
                      placeholder="Подпись: диспетчер, бухгалтерия…"
                      aria-label={`Телефон ${index + 1}: подпись`}
                      list={`${base}-label-hints`}
                      autoComplete="off"
                      onChange={(event) =>
                        setPhones(updatePhone(phones, phone.key, { label: event.target.value }))
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Телефон ${index + 1}: удалить`}
                    onClick={() => setPhones(removePhone(phones, phone.key))}
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                  <div className="phone-edit__emergency">
                    <CheckLine
                      checked={phone.emergency}
                      onChange={(checked) =>
                        setPhones(updatePhone(phones, phone.key, { emergency: checked }))
                      }
                    >
                      Аварийный
                    </CheckLine>
                  </div>
                  <FieldError id={`${rowId}-error`} text={error} />
                </li>
              );
            })}
          </ul>
        )}
        <datalist id={`${base}-label-hints`}>
          {PHONE_LABEL_HINTS.map((hint) => (
            <option key={hint} value={hint} />
          ))}
        </datalist>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={phones.length >= MAX_PHONES}
          onClick={() => setPhones(addPhone(phones))}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить телефон
        </button>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id('website')}>
          Сайт
        </label>
        <input
          id={id('website')}
          className="input"
          type="text"
          inputMode="url"
          value={website}
          autoComplete="off"
          aria-invalid={errors?.website !== undefined}
          aria-describedby={described('website', errors?.website)}
          onChange={(event) => setWebsite(event.target.value)}
        />
        <FieldError id={id('website-error')} text={errors?.website} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('address')}>
          Адрес
        </label>
        <input
          id={id('address')}
          className="input"
          value={address}
          maxLength={MAX_TEXT}
          autoComplete="off"
          aria-invalid={errors?.address !== undefined}
          aria-describedby={described('address', errors?.address)}
          onChange={(event) => setAddress(event.target.value)}
        />
        <FieldError id={id('address-error')} text={errors?.address} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('hours')}>
          Часы работы
        </label>
        <input
          id={id('hours')}
          className="input"
          value={openingHours}
          maxLength={MAX_TEXT}
          autoComplete="off"
          aria-invalid={errors?.openingHours !== undefined}
          aria-describedby={described('hours', errors?.openingHours)}
          onChange={(event) => setOpeningHours(event.target.value)}
        />
        <FieldError id={id('hours-error')} text={errors?.openingHours} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('note')}>
          Заметка
        </label>
        <textarea
          id={id('note')}
          className="textarea"
          value={note}
          maxLength={MAX_NOTE}
          aria-invalid={errors?.note !== undefined}
          aria-describedby={described('note', errors?.note)}
          onChange={(event) => setNote(event.target.value)}
        />
        <FieldError id={id('note-error')} text={errors?.note} />
      </div>

      {visibility ? (
        <VisibilityPicker
          value={visibility.value}
          options={visibility.options}
          onChange={visibility.onChange}
        />
      ) : null}
      {visibilityNote}

      <ObjectError error={state.error} action="contact" />
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
