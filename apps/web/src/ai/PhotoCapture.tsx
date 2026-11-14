import { useRef, useState } from 'react';
import type { z } from 'zod';
import { ApiError } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { aiError, useAiStatus } from './AiCapture.tsx';
import { useAiConsent } from './consent.tsx';
import { IdentityConfirmation } from './IdentityConfirmation.tsx';

export function PhotoCapture<T>({
  house,
  path,
  schema,
  label,
  onResult,
  onManual,
}: {
  house: string | null;
  path: string;
  schema: z.ZodType<T>;
  label: string;
  onResult: (draft: T, file: File) => void;
  onManual: (file: File) => void;
}) {
  const status = useAiStatus(house);
  const consent = useAiConsent(house, status.data?.provider);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ file: File; path: string; house: string }>();
  const question =
    confirmation?.path === path && confirmation.house === house ? confirmation : undefined;
  async function extract(file: File, identityConfirmed = false) {
    if (busy.current || !house) return;
    busy.current = true;
    setPending(true);
    setConfirmation(undefined);
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new ApiError(413, 'AI_IMAGE_TOO_LARGE');
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(
        `/api/ai/${path}&spaceId=${house}&consent=true${identityConfirmed ? '&identityConfirmed=true' : ''}`,
        {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
          cache: 'no-store',
        },
      );
      const body: unknown = await response.json();
      if (!response.ok)
        throw new ApiError(
          response.status,
          typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '',
        );
      const draft = schema.safeParse(body);
      if (!draft.success) throw new ApiError(502, 'AI_INVALID_RESPONSE');
      onResult(draft.data, file);
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 422 &&
        failure.code === 'AI_PRIVATE_DOCUMENT'
      ) {
        setConfirmation({ file, path, house });
        return;
      }
      setError(
        failure instanceof ApiError && failure.code === 'AI_IMAGE_TOO_LARGE'
          ? 'Фото должно быть не больше 10 МБ.'
          : aiError(failure),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!status.data?.enabled) return null;
  return (
    <div className="field">
      <input
        type="file"
        ref={input}
        hidden
        accept="image/*"
        capture="environment"
        aria-label={label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) consent.ask(() => void extract(file));
        }}
      />
      <button
        type="button"
        className="btn btn--secondary"
        disabled={pending || !!question}
        onClick={() => input.current?.click()}
      >
        {pending ? 'Разбираем…' : label}
      </button>
      {error ? <Notice error>{error} Поля формы сохранены.</Notice> : null}
      {question ? (
        <IdentityConfirmation
          onRecognize={() => void extract(question.file, true)}
          onManual={() => {
            setConfirmation(undefined);
            onManual(question.file);
          }}
        />
      ) : null}
      {consent.dialog}
    </div>
  );
}
