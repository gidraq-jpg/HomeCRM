import { DraftSchemas } from '@homecrm/shared';
import { useRef, useState } from 'react';
import { aiError, useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import type { ShoppingDraft } from '../voice/shopping-dictation.ts';

export function ShoppingAiCapture({
  text,
  house,
  beforeExtract,
  onDrafts,
}: {
  text: string;
  house: string | null;
  beforeExtract: () => void;
  onDrafts: (drafts: ShoppingDraft[]) => void;
}) {
  const status = useAiStatus(house);
  const consent = useAiConsent(house, status.data?.provider);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  async function extract() {
    if (busy.current || !house || !text.trim()) return;
    busy.current = true;
    beforeExtract();
    setPending(true);
    setError('');
    try {
      const result = await apiRequest('POST', 'ai/extract', DraftSchemas.shopping, {
        kind: 'shopping',
        text,
        spaceId: house,
        consent: true,
      });
      onDrafts(
        result.map((draft) => ({
          title: draft.title.value,
          titleConfident: draft.title.confident,
          quantityConfident: draft.quantity.confident,
          ...(draft.quantity.value ? { quantity: draft.quantity.value } : {}),
        })),
      );
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      {status.data?.enabled ? (
        <button
          type="button"
          className="btn btn--secondary ai-trigger"
          disabled={pending || !text.trim()}
          onClick={() => consent.ask(() => void extract())}
        >
          {pending ? 'Разбираем…' : 'Разобрать'}
        </button>
      ) : null}
      {error ? <Notice error>{error} Введённый текст сохранён.</Notice> : null}
      {consent.dialog}
    </>
  );
}
