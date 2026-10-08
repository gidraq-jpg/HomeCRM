import type { PropertyData } from '@homecrm/shared';
import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { Notice, type useAction } from '../auth/components.tsx';
import { PropertyFields } from '../property/PropertyFields.tsx';
import {
  EMPTY_PROPERTY,
  type PropertyDraft,
  type PropertyErrors,
  toPropertyData,
} from '../property/property.ts';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { type FieldInput, MAX_FIELD_NAME, MAX_FIELD_VALUE, MAX_FIELDS, MAX_TITLE } from './api.ts';
import { ObjectError } from './components.tsx';
import { addField, type DraftField, removeField, toInput, updateField } from './fields.ts';
import { OBJECT_TYPE_LABELS, OBJECT_TYPES, type ObjectType } from './types.ts';

export interface ObjectDraft {
  title: string;
  objectType: ObjectType;
  /** Ответственный; в личном объекте это всегда владелец, выбор не показывается. */
  assigneeId: string | null;
  fields: DraftField[];
  /** Поля недвижимости: показываются, когда выбран тип «Недвижимость». */
  property: PropertyDraft;
}

export const EMPTY_DRAFT: ObjectDraft = {
  title: '',
  objectType: 'other',
  assigneeId: null,
  fields: [],
  property: EMPTY_PROPERTY,
};

export interface ObjectValues {
  title: string;
  objectType: ObjectType;
  assigneeId: string | null;
  fields: FieldInput[];
  /** Поля недвижимости; 
ull, если выбран другой тип. */
  typeData: PropertyData | null;
}

interface VisibilityChoice {
  value: Visibility;
  options: readonly Visibility[];
  onChange: (value: Visibility) => void;
}

interface ConflictChoice {
  /** Взять версию с сервера: правка пропадёт. */
  onReload: () => void;
  /** Сохранить введённое отдельным объектом и оставить версию сервера как есть. */
  onSaveCopy: (values: ObjectValues) => void;
}

export interface AssigneeOption {
  id: string;
  name: string;
}

interface ObjectFormProps {
  draft: ObjectDraft;
  /** При создании полей и ответственного нет: их добавляют в карточке. */
  mode: 'create' | 'edit';
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  action: 'create' | 'save';
  onSubmit: (values: ObjectValues) => void;
  onCancel: () => void;
  /** Строка «Кто видит» над кнопкой «Сохранить»: только при создании (PRD 7.4). */
  visibility?: VisibilityChoice;
  visibilityNote?: ReactNode;
  /** Кого можно назначить ответственным; меньше двух вариантов — выбор не показывается. */
  assignees?: readonly AssigneeOption[];
  conflict?: ConflictChoice;
  /** Тип выбрали или сменили: форма создания пересчитывает «Кто видит» по таблице 7.2. */
  onObjectTypeChange?: (type: ObjectType) => void;
}

/**
 * Форма объекта: название, тип, свои поля, ответственный. Всё введённое живёт только в памяти
 * этой страницы: в localStorage, адрес и журнал черновик не попадает.
 */
export function ObjectForm({
  draft,
  mode,
  submitLabel,
  pendingLabel,
  state,
  action,
  onSubmit,
  onCancel,
  visibility,
  visibilityNote,
  assignees = [],
  conflict,
  onObjectTypeChange,
}: ObjectFormProps) {
  const [title, setTitle] = useState(draft.title);
  const [objectType, setObjectType] = useState<ObjectType>(draft.objectType);
  const [assigneeId, setAssigneeId] = useState(draft.assigneeId);
  const [fields, setFields] = useState<DraftField[]>(draft.fields);
  const [property, setProperty] = useState<PropertyDraft>(draft.property);
  const [propertyErrors, setPropertyErrors] = useState<PropertyErrors>({});
  const [touched, setTouched] = useState(false);
  const [unnamed, setUnnamed] = useState<string | null>(null);
  const ids = { title: useId(), assignee: useId(), property: useId() };

  const titleMissing = touched && title.trim() === '';

  /** Значения формы; `null`, если у поля есть значение, но нет названия. */
  function values(): ObjectValues | null {
    const parsed = toInput(fields);
    if (!parsed.ok) {
      setUnnamed(parsed.key);
      return null;
    }
    setUnnamed(null);
    let typeData: PropertyData | null = null;
    if (objectType === 'property') {
      const result = toPropertyData(property);
      if (!result.ok) {
        setPropertyErrors(result.errors);
        const first = result.errors.address ? 'address' : result.errors.area ? 'area' : 'cadastral';
        document.getElementById(`${ids.property}-${first}`)?.focus();
        return null;
      }
      typeData = result.data;
    }
    setPropertyErrors({});
    return { title: title.trim(), objectType, assigneeId, fields: parsed.fields, typeData };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (title.trim() === '') {
      document.getElementById(ids.title)?.focus();
      return;
    }
    const next = values();
    if (next) onSubmit(next);
  }

  const typeOptions = OBJECT_TYPES.map((value) => ({ value, label: OBJECT_TYPE_LABELS[value] }));

  return (
    <form className="object-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.title}>
          Название
        </label>
        <input
          id={ids.title}
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={MAX_TITLE}
          autoComplete="off"
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? `${ids.title}-error` : undefined}
        />
        {titleMissing ? (
          <p className="field__error" id={`${ids.title}-error`} role="alert">
            Введите название: без него объект не сохранить.
          </p>
        ) : null}
      </div>

      <div className="field">
        <span className="field__label" aria-hidden="true">
          Тип
        </span>
        <ChipGroup
          legend="Тип объекта"
          value={objectType}
          options={typeOptions}
          onChange={(value) => {
            setObjectType(value);
            onObjectTypeChange?.(value);
          }}
        />
      </div>

      {objectType === 'property' ? (
        <PropertyFields
          draft={property}
          errors={propertyErrors}
          idPrefix={ids.property}
          onChange={(change) => setProperty((previous) => ({ ...previous, ...change }))}
        />
      ) : null}

      {mode === 'edit' && assignees.length > 1 ? (
        <div className="field">
          <label className="field__label" htmlFor={ids.assignee}>
            Ответственный
          </label>
          <select
            id={ids.assignee}
            className="select"
            value={assigneeId ?? ''}
            onChange={(event) => setAssigneeId(event.target.value || null)}
          >
            {assigneeId === null ? <option value="">Не назначен</option> : null}
            {assignees.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <fieldset className="field-edit">
          <legend className="field__label">Свои поля</legend>
          {fields.length === 0 ? (
            <p className="field__hint">Своих полей пока нет. Например: «Площадь — 54 м²».</p>
          ) : (
            <ul className="field-edit__list">
              {fields.map((field, index) => (
                <li className="field-edit__item" key={field.key}>
                  <input
                    className="input"
                    value={field.name}
                    maxLength={MAX_FIELD_NAME}
                    placeholder="Название"
                    aria-label={`Поле ${index + 1}: название`}
                    aria-invalid={unnamed === field.key}
                    autoComplete="off"
                    onChange={(event) =>
                      setFields(updateField(fields, field.key, { name: event.target.value }))
                    }
                  />
                  <input
                    className="input"
                    value={field.value}
                    maxLength={MAX_FIELD_VALUE}
                    placeholder="Значение"
                    aria-label={`Поле ${index + 1}: значение`}
                    autoComplete="off"
                    onChange={(event) =>
                      setFields(updateField(fields, field.key, { value: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Поле ${index + 1}: удалить`}
                    onClick={() => setFields(removeField(fields, field.key))}
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unnamed === null ? null : (
            <p className="field__error" role="alert">
              У поля есть значение, но нет названия. Назовите его или очистите строку.
            </p>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={fields.length >= MAX_FIELDS}
            onClick={() => setFields(addField(fields))}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить поле
          </button>
          {fields.length >= MAX_FIELDS ? (
            <p className="field__hint">В объекте уже {MAX_FIELDS} полей — больше нельзя.</p>
          ) : null}
        </fieldset>
      ) : (
        <p className="field__hint">
          Свои поля, события в ленте и связи с другими записями добавляются в карточке объекта.
        </p>
      )}

      {visibility ? (
        <VisibilityPicker
          value={visibility.value}
          options={visibility.options}
          onChange={visibility.onChange}
        />
      ) : null}
      {visibilityNote}

      {conflict ? (
        <Notice error>
          <strong>Объект изменили, пока вы его правили.</strong>
          <p>
            «Обновить» покажет свежую версию, а то, что вы ввели, пропадёт. «Сохранить мою версию
            как копию» оставит ваши данные отдельным объектом, а свежую версию не тронет.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={conflict.onReload}>
              Обновить
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={state.disabled || title.trim() === ''}
              onClick={() => {
                const next = values();
                if (next) conflict.onSaveCopy(next);
              }}
            >
              Сохранить мою версию как копию
            </button>
          </div>
        </Notice>
      ) : null}
      <ObjectError error={state.error} action={action} />

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
