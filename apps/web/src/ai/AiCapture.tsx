import { AiStatus, type AutoDraft, AutoDrafts } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { Visibility } from '../access/visibility.ts';
import { ApiError, apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { AiDrafts } from './AiDrafts.tsx';
import './ai.css';

export function aiError(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'AI_DAILY_LIMIT') return 'Дневной предел ИИ исчерпан. Можно ввести вручную.';
  if (code === 'AI_BUSY') return 'Служба ИИ занята. Повторите чуть позже.';
  if (code === 'AI_DISABLED') return 'ИИ выключен в доме. Можно ввести вручную.';
  if (code === 'AI_INVALID_RESPONSE')
    return 'Не удалось разобрать. Поправьте фразу или введите вручную.';
  return 'Служба ИИ недоступна. Проверьте, включён ли компьютер семьи, или введите вручную.';
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
  const status = useQuery({
    queryKey: ['ai-status', me.id, house],
    enabled: !!house,
    queryFn: ({ signal }) =>
      apiRequest('GET', `ai/status?spaceId=${house}`, AiStatus, undefined, signal),
    staleTime: 0,
  });
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<AutoDraft[] | null>(null);
  const key = `homecrm:ai-consent:v1:${me.id}:${house}`;
  const accepted = useRef(new Set<string>());
  function hasConsent() {
    try {
      return accepted.current.has(key) || localStorage.getItem(key) === 'yes';
    } catch {
      return accepted.current.has(key);
    }
  }
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
            if (hasConsent()) void extract();
            else setConsent(true);
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
      {consent ? (
        <Sheet
          open
          title="Разбор с помощью ИИ"
          description="Перед первой отправкой"
          onOpenChange={setConsent}
        >
          <p>
            Фраза, сегодняшняя дата, имена участников и названия доступных вам объектов дома уйдут
            через Hermes на компьютере семьи во внешнюю модель (сейчас OpenAI).
          </p>
          <p>
            Другие записи и файлы не отправляются. Фото паспортов, удостоверений и медицинские
            документы во внешнюю модель не уходят.
          </p>
          <p>
            ИИ предложит черновики. Ничего не сохранится, пока вы не проверите их и не нажмёте
            «Сохранить».
          </p>
          <p className="muted">Согласие запомнится для вас и этого дома в этом браузере.</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                accepted.current.add(key);
                try {
                  localStorage.setItem(key, 'yes');
                } catch {
                  /* При запрете хранилища согласие действует до закрытия страницы. */
                }
                setConsent(false);
                void extract();
              }}
            >
              Согласен, разобрать
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setConsent(false)}>
              Отмена
            </button>
          </div>
        </Sheet>
      ) : null}
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
