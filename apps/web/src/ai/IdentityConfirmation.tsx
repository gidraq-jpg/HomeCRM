import { useEffect, useRef } from 'react';

export function IdentityConfirmation({
  onRecognize,
  onManual,
  pending = false,
  disabled = false,
  focus = true,
}: {
  onRecognize: () => void;
  onManual: () => void;
  pending?: boolean;
  disabled?: boolean;
  focus?: boolean;
}) {
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focus) question.current?.focus();
  }, [focus]);
  return (
    <div className="field">
      <p ref={question} tabIndex={-1}>
        Похоже на документ личности. Распознать всё равно?
      </p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={disabled || pending}
          onClick={onRecognize}
        >
          {pending ? 'Разбираем…' : 'Распознать'}
        </button>
        <button type="button" className="btn btn--secondary" disabled={pending} onClick={onManual}>
          Заполню вручную
        </button>
      </div>
    </div>
  );
}
