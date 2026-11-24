import type { Ref } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { DictationButton, DictationStatus } from '../voice/Dictation.tsx';
import { ShoppingAiCapture } from './ShoppingAiCapture.tsx';
import { ShoppingError } from './ShoppingError.tsx';
import type { ShoppingQuickAddState } from './useShopping.ts';

/** Строка «Добавить одной строкой» с диктовкой, разбором ИИ и параметрами покупки. */
export function ShoppingQuickAdd({
  quick,
  input,
  quickAdd,
  house,
  options,
  place,
  setPlace,
  onDetails,
}: {
  quick: Ref<HTMLFormElement>;
  input: Ref<HTMLTextAreaElement>;
  quickAdd: ShoppingQuickAddState;
  house: string;
  options: Visibility[];
  place: Visibility;
  setPlace: (value: Visibility) => void;
  onDetails: () => void;
}) {
  const { title, setTitle, setDictated, setDrafts, ai, dictation, state, add } = quickAdd;
  return (
    <form ref={quick} className="shopping-quick" onSubmit={add}>
      <label className="field__label" htmlFor="shopping-quick-title">
        Добавить одной строкой
      </label>
      <div className="shopping-quick__line voice-line">
        <textarea
          ref={input}
          id="shopping-quick-title"
          className="input"
          value={title}
          maxLength={ai.data?.enabled ? 20000 : 2000}
          rows={Math.min(5, Math.max(1, title.split('\n').length))}
          placeholder="Что купить?"
          required
          enterKeyHint="done"
          readOnly={state.disabled}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              window.matchMedia('(hover: hover) and (pointer: fine)').matches
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onChange={(event) => {
            setTitle(event.target.value);
            if (!event.target.value) setDictated(false);
          }}
        />
        <DictationButton dictation={dictation} />
        <ShoppingAiCapture
          key={house}
          text={title}
          house={house || null}
          onDrafts={setDrafts}
          beforeExtract={dictation.abort}
        />
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          Добавить
        </button>
      </div>
      <DictationStatus dictation={dictation} />
      <details className="studio-list-options">
        <summary>Параметры покупки</summary>
        <VisibilityPicker
          value={options.includes(place) ? place : 'personal'}
          options={options}
          onChange={setPlace}
        />
        <button type="button" className="text-button" onClick={onDetails}>
          Количество, заметка и связи
        </button>
      </details>
      <ShoppingError error={state.error} />
    </form>
  );
}
