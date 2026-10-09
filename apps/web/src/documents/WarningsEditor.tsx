import { DOCUMENT_LABELS, documentWarnings } from '@homecrm/shared';
import { PencilSimple } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { useAction } from '../auth/components.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import { useToast } from '../ui/Toast.tsx';
import { type DocumentCard, MAX_WARNINGS, patchDocument } from './api.ts';
import { DocumentError } from './components.tsx';
import { parseWarnings } from './form.ts';
import { warningsLabel } from './labels.ts';
import { useRefreshDocuments } from './queries.ts';

/**
 * Предупреждения о сроке (DOC-3): значения по умолчанию берутся из типа документа (приложение Б),
 * в карточке их можно заменить своими, отключить совсем или вернуть значения типа.
 */
export function WarningsEditor({ card, canChange }: { card: DocumentCard; canChange: boolean }) {
  const toast = useToast();
  const refresh = useRefreshDocuments();
  const state = useAction();
  const [open, setOpen] = useState(false);
  const own = card.data.warnings;
  const effective = card.warnings ?? own ?? documentWarnings(card.data.type);
  const [off, setOff] = useState(own !== undefined && own.length === 0);
  const [days, setDays] = useState((own ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const typeDefault = warningsLabel(documentWarnings(card.data.type));
  const summary = effective.length === 0 ? 'Не предупреждать' : warningsLabel(effective);

  function save(next: number[] | null) {
    void state.run(async () => {
      const { warnings: _previous, ...rest } = card.data;
      await patchDocument(card.id, {
        data: next === null ? rest : { ...rest, warnings: next },
        expectedUpdatedAt: card.updatedAt,
      });
      await refresh();
      setOpen(false);
      toast.show({
        message: next === null ? 'Предупреждения как у типа' : 'Предупреждения сохранены',
      });
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (off) return save([]);
    const parsed = parseWarnings(days);
    if (parsed === null) {
      return setError('Введите дни числами от 0 до 365 через запятую, например: 60, 30.');
    }
    if (parsed.length === 0) {
      return setError('Укажите дни или отметьте «Не предупреждать».');
    }
    if (parsed.length > MAX_WARNINGS) return setError(`Предупреждений не больше ${MAX_WARNINGS}.`);
    setError(null);
    save(parsed);
  }

  if (!open) {
    return (
      <>
        <span>
          {summary}
          {own === undefined ? ' (по умолчанию для типа)' : ' (свои)'}
        </span>
        {canChange ? (
          <button
            type="button"
            className="text-button"
            aria-label="Изменить предупреждения"
            onClick={() => {
              setOff(own !== undefined && own.length === 0);
              setDays((own ?? effective).join(', '));
              setError(null);
              state.setError(null);
              setOpen(true);
            }}
          >
            <PencilSimple size={18} aria-hidden />
            Изменить
          </button>
        ) : null}
      </>
    );
  }

  return (
    <form className="warnings-edit" onSubmit={submit} noValidate aria-busy={state.pending}>
      <p className="muted">
        По умолчанию для типа «{DOCUMENT_LABELS[card.data.type]}»: {typeDefault}.
      </p>
      <CheckLine checked={off} onChange={setOff}>
        Не предупреждать
      </CheckLine>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Предупреждать за, дней
        </label>
        <input
          id={inputId}
          className="input"
          value={days}
          disabled={off}
          maxLength={200}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => setDays(event.target.value)}
        />
        {error ? (
          <p className="field__error" id={`${inputId}-error`} role="alert">
            {error}
          </p>
        ) : (
          <p className="field__hint">Через запятую, например: 60, 30.</p>
        )}
      </div>
      <DocumentError error={state.error} action="save" />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={state.disabled}
          onClick={() => save(null)}
        >
          Как у типа
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
