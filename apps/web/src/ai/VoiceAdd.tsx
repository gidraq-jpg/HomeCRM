import { type AutoDraft, AutoDrafts } from '@homecrm/shared';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { haptic } from '../ui/haptic.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { DictationStatus, useDictation } from '../voice/Dictation.tsx';
import { aiError, useAiStatus } from './AiCapture.tsx';
import { AiDrafts } from './AiDrafts.tsx';
import { consentKey } from './consent.tsx';

const VoiceAddContext = createContext<{ enabled: boolean; start: (held?: boolean) => void } | null>(
  null,
);
export const useVoiceAdd = () => useContext(VoiceAddContext);
export function VoiceAddProvider({ children }: { children: ReactNode }) {
  const { householdId, me } = useHousehold();
  const status = useAiStatus(householdId);
  const [session, setSession] = useState<{ held: boolean } | null>(null);
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((n) => n + 1);
    window.addEventListener('ai-consent', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('ai-consent', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  let accepted = false;
  try {
    accepted =
      localStorage.getItem(consentKey(me.id, householdId, status.data?.provider)) === 'yes';
  } catch {
    /* Без согласия действие недоступно. */
  }
  const enabled = !!status.data?.enabled && accepted;
  return (
    <VoiceAddContext.Provider
      value={{
        enabled,
        start: (held = false) => {
          if (enabled) setSession({ held });
        },
      }}
    >
      {children}
      {session && householdId ? (
        <VoiceAdd house={householdId} held={session.held} onClose={() => setSession(null)} />
      ) : null}
    </VoiceAddContext.Provider>
  );
}
function VoiceAdd({ house, held, onClose }: { house: string; held: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<AutoDraft[] | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  async function extract(value: string) {
    if (cancelled.current || busy.current) return;
    setText(value);
    if (!value.trim()) return;
    if (!navigator.onLine) {
      setError('Нет сети. Текст сохранён на этом экране: скопируйте его или отправьте позже.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      setDrafts(
        await apiRequest('POST', 'ai/extract', AutoDrafts, {
          kind: 'auto',
          text: value,
          spaceId: house,
          consent: true,
        }),
      );
    } catch (failure) {
      setError(`${aiError(failure)} Текст сохранён на этом экране.`);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const dictation = useDictation((value) => {
    void extract(value);
    return undefined;
  });
  const lastHeard = useRef('');
  if (dictation.interim) lastHeard.current = dictation.interim;
  const controls = useRef(dictation);
  controls.current = dictation;
  useEffect(() => {
    cancelled.current = false;
    controls.current.toggle();
    if (controls.current.supported && navigator.onLine) haptic();
    const release = () => {
      if (held && controls.current.listening) controls.current.toggle();
    };
    const cancel = () => {
      controls.current.abort();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [held]);
  useEffect(() => {
    if (dictation.error && lastHeard.current) setText(lastHeard.current);
  }, [dictation.error]);
  function close() {
    cancelled.current = true;
    dictation.abort();
    onClose();
  }
  if (drafts) return <AiDrafts drafts={drafts} house={house} place="personal" onClose={onClose} />;
  return (
    <Sheet
      open
      title={dictation.listening ? 'Слушаю…' : 'Сказать ИИ'}
      description="Скажите, что добавить, или введите текст."
      onOpenChange={() => {
        if (!pending) close();
      }}
    >
      <DictationStatus dictation={dictation} />
      {!dictation.supported ? (
        <Notice>Браузер не поддерживает распознавание речи. Введите текст.</Notice>
      ) : null}
      <label className="field">
        <span>Текст для разбора</span>
        <textarea
          className="textarea"
          rows={4}
          maxLength={20000}
          value={dictation.listening ? dictation.interim : text}
          readOnly={dictation.listening}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error ? <Notice error>{error}</Notice> : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={pending}
          onClick={() => {
            if (dictation.listening) dictation.toggle();
            else void extract(text);
          }}
        >
          {pending ? 'Разбираем…' : 'Готово'}
        </button>
        <button type="button" className="btn btn--secondary" disabled={pending} onClick={close}>
          Отмена
        </button>
      </div>
    </Sheet>
  );
}
