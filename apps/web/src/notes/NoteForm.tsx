import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { Notice, type useAction } from '../auth/components.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import { CheckToggle } from '../ui/CheckToggle.tsx';
import { MAX_BODY, MAX_ITEMS, MAX_TITLE, type NoteInput } from './api.ts';
import { addItem, type DraftItem, moveItem, removeItem, toInput, updateItem } from './checklist.ts';
import { NoteError } from './components.tsx';

export interface NoteDraft {
  title: string;
  body: string;
  pinned: boolean;
  checklist: DraftItem[];
}

export const EMPTY_DRAFT: NoteDraft = { title: '', body: '', pinned: false, checklist: [] };

interface VisibilityChoice {
  value: Visibility;
  options: readonly Visibility[];
  onChange: (value: Visibility) => void;
}

interface ConflictChoice {
  /** Взять версию с сервера: правка пропадёт. */
  onReload: () => void;
  /** Сохранить введённое отдельной заметкой и оставить версию сервера как есть. */
  onSaveCopy: (values: NoteInput) => void;
}

interface NoteFormProps {
  draft: NoteDraft;
  submitLabel: string;
  pendingLabel: string;
  state: ReturnType<typeof useAction>;
  action: 'create' | 'save';
  onSubmit: (values: NoteInput) => void;
  onCancel: () => void;
  /** Строка «Кто видит» над кнопкой «Сохранить»: только при создании (PRD 7.4). */
  visibility?: VisibilityChoice;
  conflict?: ConflictChoice;
  /** Пояснение под строкой «Кто видит», например почему нет общих значений. */
  visibilityNote?: ReactNode;
}

/**
 * Форма заметки: заголовок, текст, чек-лист, закрепление. Всё введённое живёт только в памяти
 * этой страницы: в localStorage, адрес и журнал черновик не попадает.
 */
export function NoteForm({
  draft,
  submitLabel,
  pendingLabel,
  state,
  action,
  onSubmit,
  onCancel,
  visibility,
  conflict,
  visibilityNote,
}: NoteFormProps) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [pinned, setPinned] = useState(draft.pinned);
  const [items, setItems] = useState<DraftItem[]>(draft.checklist);
  const [touched, setTouched] = useState(false);
  const ids = { title: useId(), body: useId() };
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (focusKey === null) return;
    inputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const values = (): NoteInput => ({
    title: title.trim(),
    body,
    pinned,
    checklist: toInput(items),
  });
  const titleMissing = touched && title.trim() === '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (title.trim() === '') {
      document.getElementById(ids.title)?.focus();
      return;
    }
    onSubmit(values());
  }

  function append(after?: string) {
    const next = addItem(items);
    if (next.length === items.length) return;
    const added = next[next.length - 1];
    if (!added) return;
    if (after !== undefined) {
      // Новый пункт встаёт сразу под тем, где нажали Enter.
      const index = items.findIndex((item) => item.key === after);
      const reordered = [...items];
      reordered.splice(index + 1, 0, added);
      setItems(reordered);
    } else {
      setItems(next);
    }
    setFocusKey(added.key);
  }

  return (
    <form className="note-form" onSubmit={submit} aria-busy={state.pending} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.title}>
          Заголовок
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
            Введите заголовок: без него заметку не сохранить.
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.body}>
          Текст
        </label>
        <textarea
          id={ids.body}
          className="textarea note-form__body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_BODY}
          rows={8}
          aria-describedby={`${ids.body}-hint`}
        />
        <p className="field__hint" id={`${ids.body}-hint`}>
          Можно писать в Markdown: **жирный**, *курсив*, списки через «-», заголовки через «#»,
          ссылки в виде [текст](https://адрес).
        </p>
      </div>

      <fieldset className="checklist-edit">
        <legend className="field__label">Чек-лист</legend>
        {items.length === 0 ? (
          <p className="field__hint">Пунктов пока нет. Добавьте первый.</p>
        ) : (
          <ul className="checklist-edit__list">
            {items.map((item, index) => (
              <li className="checklist-edit__item" key={item.key}>
                <CheckToggle
                  checked={item.done}
                  label={`Пункт ${index + 1}: выполнено`}
                  onChange={() => setItems(updateItem(items, item.key, { done: !item.done }))}
                />
                <input
                  ref={(element) => {
                    if (element) inputs.current.set(item.key, element);
                    else inputs.current.delete(item.key);
                  }}
                  className="input checklist-edit__title"
                  value={item.title}
                  maxLength={MAX_TITLE}
                  aria-label={`Пункт ${index + 1}`}
                  autoComplete="off"
                  onChange={(event) =>
                    setItems(updateItem(items, item.key, { title: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    append(item.key);
                  }}
                />
                <div className="checklist-edit__tools">
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Пункт ${index + 1}: выше`}
                    disabled={index === 0}
                    onClick={() => setItems(moveItem(items, item.key, -1))}
                  >
                    <ArrowUp size={20} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Пункт ${index + 1}: ниже`}
                    disabled={index === items.length - 1}
                    onClick={() => setItems(moveItem(items, item.key, 1))}
                  >
                    <ArrowDown size={20} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label={`Пункт ${index + 1}: удалить`}
                    onClick={() => setItems(removeItem(items, item.key))}
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={items.length >= MAX_ITEMS}
          onClick={() => append()}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить пункт
        </button>
        {items.length >= MAX_ITEMS ? (
          <p className="field__hint">В заметке уже {MAX_ITEMS} пунктов — больше нельзя.</p>
        ) : null}
      </fieldset>

      <CheckLine checked={pinned} onChange={setPinned}>
        Закрепить вверху списка
      </CheckLine>

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
          <strong>Заметку изменили, пока вы её правили.</strong>
          <p>
            «Обновить» покажет свежую версию, а то, что вы ввели, пропадёт. «Сохранить мою версию
            как копию» оставит ваш текст отдельной заметкой, а свежую версию не тронет.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={conflict.onReload}>
              Обновить
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={state.disabled || title.trim() === ''}
              onClick={() => conflict.onSaveCopy(values())}
            >
              Сохранить мою версию как копию
            </button>
          </div>
        </Notice>
      ) : (
        <NoteError error={state.error} action={action} />
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
