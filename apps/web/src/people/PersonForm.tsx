import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import type { useAction } from '../auth/components.tsx';
import { ObjectError } from '../objects/components.tsx';
import { addPhone, PHONE_LABEL_HINTS, removePhone, updatePhone } from '../organizations/form.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import {
  MAX_EMAIL,
  MAX_ITEMS,
  MAX_LABEL,
  MAX_NOTE,
  MAX_TEXT,
  MAX_TITLE,
  type PersonInput,
} from './api.ts';
import {
  type EmailDraft,
  type MessengerDraft,
  nextKey,
  type PersonDraft,
  type PersonErrors,
  toggleCategory,
  toPersonInput,
} from './form.ts';
import { CATEGORY_OPTIONS } from './labels.ts';

interface PersonFormProps {
  draft: PersonDraft;
  /** Организации, которые видит участник: человек может работать в одной из них. */
  organizations: readonly { id: string; title: string }[];
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  onSubmit: (values: PersonInput) => void;
  onCancel: () => void;
  /** Категории изменились: форма создания подбирает «Кто видит» (мастер по умолчанию общий). */
  onCategoriesChange?: (categories: PersonDraft['categories']) => void;
  /** «Кто видит» над «Сохранить»: только при создании (PRD 7.4). */
  children?: ReactNode;
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text === undefined ? null : (
    <p className="field__error" id={id} role="alert">
      {text}
    </p>
  );
}

/**
 * Форма человека (CONT-1): ФИО, категории, телефоны, почта, мессенджеры, адрес, день рождения с
 * годом или без, организация и заметка. Всё введённое живёт только в памяти страницы.
 */
export function PersonForm({
  draft,
  organizations,
  submitLabel,
  pendingLabel,
  state,
  onSubmit,
  onCancel,
  onCategoriesChange,
  children,
}: PersonFormProps) {
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<PersonErrors | null>(null);
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const set = (change: Partial<PersonDraft>) =>
    setValues((previous) => ({ ...previous, ...change }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toPersonInput(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first =
        result.errors.title !== undefined
          ? id('title')
          : (firstKey(result.errors.phones, id('phone')) ??
            firstKey(result.errors.emails, id('email')) ??
            firstKey(result.errors.messengers, id('messenger')) ??
            (result.errors.address !== undefined
              ? id('address')
              : result.errors.birthday !== undefined
                ? id('birthday')
                : id('note')));
      document.getElementById(first)?.focus();
      return;
    }
    setErrors(null);
    onSubmit(result.value);
  }

  const described = (name: string, text: string | undefined) =>
    text === undefined ? undefined : id(`${name}-error`);

  return (
    <form className="org-form person-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={id('title')}>
          ФИО
        </label>
        <input
          id={id('title')}
          className="input"
          value={values.title}
          maxLength={MAX_TITLE}
          autoComplete="off"
          required
          aria-invalid={errors?.title !== undefined}
          aria-describedby={described('title', errors?.title)}
          onChange={(event) => set({ title: event.target.value })}
        />
        <FieldError id={id('title-error')} text={errors?.title} />
      </div>

      <fieldset className="field-edit">
        <legend className="field__label">Категории</legend>
        <div className="category-list">
          {CATEGORY_OPTIONS.map((option) => (
            <CheckLine
              key={option.value}
              checked={values.categories.includes(option.value)}
              onChange={(checked) => {
                const categories = toggleCategory(values.categories, option.value, checked);
                set({ categories });
                onCategoriesChange?.(categories);
              }}
            >
              {option.label}
            </CheckLine>
          ))}
        </div>
      </fieldset>

      <fieldset className="field-edit">
        <legend className="field__label">Телефоны</legend>
        {values.phones.length === 0 ? (
          <p className="field__hint">
            Телефонов пока нет. Добавьте номер, чтобы звонить в одно касание.
          </p>
        ) : (
          <ul className="field-edit__list">
            {values.phones.map((phone, index) => {
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
                      maxLength={100}
                      placeholder="Номер"
                      aria-label={`Телефон ${index + 1}: номер`}
                      autoComplete="off"
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : `${rowId}-error`}
                      onChange={(event) =>
                        set({
                          phones: updatePhone(values.phones, phone.key, {
                            number: event.target.value,
                          }),
                        })
                      }
                    />
                    <input
                      className="input"
                      value={phone.label}
                      maxLength={MAX_LABEL}
                      placeholder="Подпись: рабочий, домашний…"
                      aria-label={`Телефон ${index + 1}: подпись`}
                      list={`${base}-label-hints`}
                      autoComplete="off"
                      onChange={(event) =>
                        set({
                          phones: updatePhone(values.phones, phone.key, {
                            label: event.target.value,
                          }),
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Телефон ${index + 1}: удалить`}
                    onClick={() => set({ phones: removePhone(values.phones, phone.key) })}
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                  <div className="phone-edit__emergency">
                    <CheckLine
                      checked={phone.emergency}
                      onChange={(checked) =>
                        set({
                          phones: updatePhone(values.phones, phone.key, { emergency: checked }),
                        })
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
          {[...PHONE_LABEL_HINTS, 'Рабочий', 'Домашний', 'Мобильный'].map((hint) => (
            <option key={hint} value={hint} />
          ))}
        </datalist>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={values.phones.length >= MAX_ITEMS}
          onClick={() => set({ phones: addPhone(values.phones) })}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить телефон
        </button>
      </fieldset>

      <fieldset className="field-edit">
        <legend className="field__label">Электронная почта</legend>
        {values.emails.length > 0 ? (
          <ul className="field-edit__list">
            {values.emails.map((email, index) => {
              const error = errors?.emails[email.key];
              const rowId = `${id('email')}-${email.key}`;
              return (
                <li className="phone-edit__item" key={email.key}>
                  <div className="phone-edit__fields">
                    <input
                      id={rowId}
                      className="input"
                      type="email"
                      inputMode="email"
                      value={email.value}
                      maxLength={MAX_EMAIL}
                      aria-label={`Почта ${index + 1}`}
                      autoComplete="off"
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : `${rowId}-error`}
                      onChange={(event) =>
                        set({ emails: patchEmail(values.emails, email.key, event.target.value) })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Почта ${index + 1}: удалить`}
                    onClick={() =>
                      set({ emails: values.emails.filter((item) => item.key !== email.key) })
                    }
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                  <FieldError id={`${rowId}-error`} text={error} />
                </li>
              );
            })}
          </ul>
        ) : null}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={values.emails.length >= MAX_ITEMS}
          onClick={() => set({ emails: [...values.emails, { key: nextKey('email'), value: '' }] })}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить почту
        </button>
      </fieldset>

      <fieldset className="field-edit">
        <legend className="field__label">Мессенджеры</legend>
        {values.messengers.length > 0 ? (
          <ul className="field-edit__list">
            {values.messengers.map((item, index) => {
              const error = errors?.messengers[item.key];
              const rowId = `${id('messenger')}-${item.key}`;
              return (
                <li className="phone-edit__item" key={item.key}>
                  <div className="phone-edit__fields">
                    <input
                      id={rowId}
                      className="input"
                      type="text"
                      inputMode="url"
                      value={item.url}
                      placeholder="Ссылка: t.me/имя"
                      aria-label={`Мессенджер ${index + 1}: ссылка`}
                      autoComplete="off"
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : `${rowId}-error`}
                      onChange={(event) =>
                        set({
                          messengers: patchMessenger(values.messengers, item.key, {
                            url: event.target.value,
                          }),
                        })
                      }
                    />
                    <input
                      className="input"
                      value={item.label}
                      maxLength={MAX_LABEL}
                      placeholder="Подпись: Telegram, Max…"
                      aria-label={`Мессенджер ${index + 1}: подпись`}
                      autoComplete="off"
                      onChange={(event) =>
                        set({
                          messengers: patchMessenger(values.messengers, item.key, {
                            label: event.target.value,
                          }),
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Мессенджер ${index + 1}: удалить`}
                    onClick={() =>
                      set({
                        messengers: values.messengers.filter((entry) => entry.key !== item.key),
                      })
                    }
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                  <FieldError id={`${rowId}-error`} text={error} />
                </li>
              );
            })}
          </ul>
        ) : null}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={values.messengers.length >= MAX_ITEMS}
          onClick={() =>
            set({
              messengers: [...values.messengers, { key: nextKey('messenger'), label: '', url: '' }],
            })
          }
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить мессенджер
        </button>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id('address')}>
          Адрес
        </label>
        <input
          id={id('address')}
          className="input"
          value={values.address}
          maxLength={MAX_TEXT}
          autoComplete="off"
          aria-invalid={errors?.address !== undefined}
          aria-describedby={described('address', errors?.address)}
          onChange={(event) => set({ address: event.target.value })}
        />
        <FieldError id={id('address-error')} text={errors?.address} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('birthday')}>
          День рождения
        </label>
        <input
          id={id('birthday')}
          className="input"
          type="date"
          value={values.birthday}
          aria-invalid={errors?.birthday !== undefined}
          aria-describedby={described('birthday', errors?.birthday)}
          onChange={(event) => set({ birthday: event.target.value })}
        />
        <FieldError id={id('birthday-error')} text={errors?.birthday} />
        <CheckLine
          checked={values.birthdayEnabled}
          onChange={(checked) => set({ birthdayEnabled: checked })}
        >
          Напоминать о дне рождения
        </CheckLine>
        <CheckLine
          checked={values.birthdayNoYear}
          onChange={(checked) => set({ birthdayNoYear: checked })}
        >
          Год рождения неизвестен
        </CheckLine>
      </div>

      {organizations.length > 0 ? (
        <div className="field">
          <label className="field__label" htmlFor={id('organization')}>
            Организация
          </label>
          <select
            id={id('organization')}
            className="select"
            value={values.organizationId}
            onChange={(event) => set({ organizationId: event.target.value })}
          >
            <option value="">Без организации</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor={id('note')}>
          Заметка
        </label>
        <textarea
          id={id('note')}
          className="textarea"
          value={values.note}
          maxLength={MAX_NOTE}
          aria-invalid={errors?.note !== undefined}
          aria-describedby={described('note', errors?.note)}
          onChange={(event) => set({ note: event.target.value })}
        />
        <FieldError id={id('note-error')} text={errors?.note} />
      </div>

      {children}

      <ObjectError error={state.error} action="person" />
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

function firstKey(map: Record<string, string>, prefix: string): string | null {
  const key = Object.keys(map)[0];
  return key === undefined ? null : `${prefix}-${key}`;
}

function patchEmail(items: readonly EmailDraft[], key: string, value: string): EmailDraft[] {
  return items.map((item) => (item.key === key ? { ...item, value } : item));
}

function patchMessenger(
  items: readonly MessengerDraft[],
  key: string,
  change: Partial<Omit<MessengerDraft, 'key'>>,
): MessengerDraft[] {
  return items.map((item) => (item.key === key ? { ...item, ...change } : item));
}
