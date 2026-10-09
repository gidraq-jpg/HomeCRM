import { DOCUMENT_LABELS, documentWarnings } from '@homecrm/shared';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Notice, type useAction } from '../auth/components.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import {
  type DocumentCard,
  MAX_ISSUED_BY,
  MAX_NOTE,
  MAX_NUMBER,
  MAX_SERIES,
  MAX_TITLE,
} from './api.ts';
import { DocumentError } from './components.tsx';
import { isStaleVersion } from './errors.ts';
import {
  type DocumentDraft,
  type DocumentErrors,
  type DocumentField,
  firstError,
  toDocument,
} from './form.ts';
import { DOCUMENT_TYPE_GROUPS, warningsLabel } from './labels.ts';

export interface DocumentValues {
  title: string;
  data: DocumentCard['data'];
}

interface DocumentFormProps {
  draft: DocumentDraft;
  /** Создание, правка действующей версии или новая версия при продлении. */
  mode: 'create' | 'edit' | 'renew';
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  action: 'create' | 'save' | 'renew';
  onSubmit: (values: DocumentValues) => void;
  onCancel: () => void;
  /** Выбор владельца: только при создании, владелец потом неизменяем. */
  owner?: ReactNode;
  /** Строки над кнопками: «Кто видит» и ответственный. */
  children?: ReactNode;
  /** Тип выбрали или сменили: форма создания пересчитывает «Кто видит». */
  onTypeChange?: (type: DocumentDraft['type']) => void;
  /** «Обновить» после конфликта версий: показать свежую версию, а введённое отбросить. */
  onReload?: () => void;
}

/**
 * Форма документа (DOC-1, DOC-2): название, тип, серия и номер, кем и когда выдан, срок или «бессрочно»,
 * заметка, теги, предупреждения. Всё введённое живёт только в памяти этой страницы.
 */
export function DocumentForm({
  draft,
  mode,
  submitLabel,
  pendingLabel,
  state,
  action,
  onSubmit,
  onCancel,
  owner,
  children,
  onTypeChange,
  onReload,
}: DocumentFormProps) {
  const [values, setValues] = useState<DocumentDraft>(draft);
  const [errors, setErrors] = useState<DocumentErrors>({});
  const base = useId();
  const id = (field: DocumentField | 'type' | 'indefinite') => `${base}-${field}`;
  const set = (change: Partial<DocumentDraft>) =>
    setValues((previous) => ({ ...previous, ...change }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = toDocument(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = firstError(result.errors);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    setErrors({});
    onSubmit({ title: result.title, data: result.data });
  }

  const warningsHint = `По умолчанию для типа «${DOCUMENT_LABELS[values.type]}»: ${warningsLabel(
    documentWarnings(values.type),
  )}.`;

  function textField(
    field: Exclude<DocumentField, 'note' | 'issuedOn' | 'expiresOn'>,
    label: string,
    options: { maxLength: number; hint?: string; required?: boolean },
  ) {
    const error = errors[field];
    return (
      <div className="field">
        <label className="field__label" htmlFor={id(field)}>
          {label}
        </label>
        <input
          id={id(field)}
          className="input"
          value={values[field]}
          maxLength={options.maxLength}
          autoComplete="off"
          required={options.required}
          aria-invalid={error !== undefined}
          aria-describedby={
            error ? `${id(field)}-error` : options.hint ? `${id(field)}-hint` : undefined
          }
          onChange={(event) => set({ [field]: event.target.value })}
        />
        {options.hint && !error ? (
          <p className="field__hint" id={`${id(field)}-hint`}>
            {options.hint}
          </p>
        ) : null}
        {error ? (
          <p className="field__error" id={`${id(field)}-error`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  function dateField(field: 'issuedOn' | 'expiresOn', label: string, disabled = false) {
    const error = errors[field];
    return (
      <div className="field">
        <label className="field__label" htmlFor={id(field)}>
          {label}
        </label>
        <input
          id={id(field)}
          className="input"
          type="date"
          value={disabled ? '' : values[field]}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error ? `${id(field)}-error` : undefined}
          onChange={(event) => set({ [field]: event.target.value })}
        />
        {error ? (
          <p className="field__error" id={`${id(field)}-error`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="document-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      {mode === 'renew' ? (
        <p className="muted">
          Откроется новая версия документа: реквизиты перенесены из прежней, а даты нужно ввести
          заново. Прежняя версия станет недействительной и останется в истории.
        </p>
      ) : null}

      {textField('title', 'Название', { maxLength: MAX_TITLE, required: true })}

      <div className="field">
        <label className="field__label" htmlFor={id('type')}>
          Тип документа
        </label>
        <select
          id={id('type')}
          className="select"
          value={values.type}
          onChange={(event) => {
            const type = event.target.value as DocumentDraft['type'];
            set({ type });
            onTypeChange?.(type);
          }}
        >
          {DOCUMENT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_LABELS[type]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {owner}

      {textField('series', 'Серия', { maxLength: MAX_SERIES })}
      {textField('number', 'Номер', { maxLength: MAX_NUMBER })}
      {textField('issuedBy', 'Кем выдан', { maxLength: MAX_ISSUED_BY })}
      {dateField('issuedOn', 'Дата выдачи')}

      <CheckLine
        checked={values.indefinite}
        onChange={(checked) => set({ indefinite: checked, ...(checked ? { expiresOn: '' } : {}) })}
      >
        Бессрочный
      </CheckLine>
      {dateField('expiresOn', 'Срок действия до', values.indefinite)}

      <div className="field">
        <label className="field__label" htmlFor={id('note')}>
          Заметка
        </label>
        <textarea
          id={id('note')}
          className="textarea"
          value={values.note}
          maxLength={MAX_NOTE}
          onChange={(event) => set({ note: event.target.value })}
        />
      </div>

      {textField('tags', 'Теги', {
        maxLength: 3200,
        hint: 'Через запятую, например: паспорт, поездка.',
      })}
      {textField('warnings', 'Предупреждать за, дней', {
        maxLength: 200,
        hint: `Через запятую; пусто — как по умолчанию. ${warningsHint}`,
      })}

      {children}

      {isStaleVersion(state.error) && onReload ? (
        <Notice error>
          <strong>Документ изменили, пока вы его правили.</strong>
          <p>«Обновить» покажет свежую версию, а то, что вы ввели, пропадёт.</p>
          <button type="button" className="btn btn--secondary" onClick={onReload}>
            Обновить
          </button>
        </Notice>
      ) : (
        <DocumentError error={state.error} action={action} />
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
