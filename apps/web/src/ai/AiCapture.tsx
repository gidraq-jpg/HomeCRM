import { AiStatus, type AutoDraft, AutoDrafts } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { Visibility } from '../access/visibility.ts';
import { ApiError, apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { AiDrafts } from './AiDrafts.tsx';
import { consentKey, useAiConsent } from './consent.tsx';
import './ai.css';

export function aiError(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'AI_DAILY_LIMIT') return 'Дневной предел ИИ исчерпан. Можно ввести вручную.';
  if (code === 'AI_BUSY') return 'Служба ИИ занята. Повторите чуть позже.';
  if (code === 'AI_FORBIDDEN')
    return 'Поставщик ИИ отклонил доступ. Обратитесь к администратору дома.';
  if (code === 'AI_NOT_FOUND')
    return 'Модель или адрес службы ИИ не найдены. Обратитесь к администратору дома.';
  if (code === 'AI_DISABLED') return 'ИИ выключен в доме. Можно ввести вручную.';
  if (code === 'AI_INVALID_RESPONSE')
    return 'Не удалось разобрать. Поправьте фразу или введите вручную.';
  return 'Служба ИИ недоступна. Проверьте, включён ли компьютер семьи, или введите вручную.';
}
export function useAiStatus(house: string | null) {
  const { me } = useHousehold();
  return useQuery({
    queryKey: ['ai-status', me.id, house],
    enabled: !!house,
    queryFn: ({ signal }) =>
      apiRequest('GET', `ai/status?spaceId=${house}`, AiStatus, undefined, signal),
    staleTime: 0,
  });
}
export function AiCapture({
  text,
  house,
  place,
  beforeExtract,
}: {
  text: string;
  house: string | null;
  place: Visibility;
  beforeExtract: () => void;
}) {
  const { me } = useHousehold();
  const status = useAiStatus(house);
  const consent = useAiConsent(house, status.data?.provider);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<AutoDraft[] | null>(null);
  const key = consentKey(me.id, house, status.data?.provider);
  async function extract() {
    if (busy.current || !house || !text.trim()) return;
    busy.current = true;
    beforeExtract();
    setPending(true);
    setError('');
    try {
      setDrafts(
        await apiRequest('POST', 'ai/extract', AutoDrafts, {
          kind: 'auto',
          text,
          spaceId: house,
          consent: true,
        }),
      );
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setPending(false);
      busy.current = false;
    }
  }
  return (
    <>
      {status.data?.enabled ? (
        <button
          type="button"
          className="btn btn--secondary ai-trigger"
          disabled={pending || !text.trim()}
          onClick={() => {
            consent.ask(() => void extract());
          }}
        >
          {pending ? 'Разбираем…' : 'Разобрать'}
        </button>
      ) : null}
      {error ? (
        <div className="ai-error">
          <Notice error>{error} Введённый текст сохранён.</Notice>
        </div>
      ) : null}
      {consent.dialog}
      {drafts ? (
        <AiDrafts
          key={key}
          drafts={drafts}
          house={house}
          place={place}
          onClose={() => setDrafts(null)}
        />
      ) : null}
    </>
  );
}
