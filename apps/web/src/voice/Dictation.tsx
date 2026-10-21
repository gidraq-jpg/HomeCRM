import { Microphone, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '../auth/components.tsx';
import {
  OFFLINE_MESSAGE,
  recognitionConstructor,
  startRecognition,
  voiceErrorMessage,
} from './recognition.ts';
import './voice.css';

export type Dictation = ReturnType<typeof useDictation>;

/**
 * Диктовка одной фразы. Без поддержки в браузере `supported = false`, и кнопки нет совсем.
 * Ошибка не стирает введённый текст: распознанное только дописывается через `onText`.
 * `onText` получает и пустой итог, если ошибки не было; вернув строку, он отклоняет фразу,
 * и эта строка показывается как ошибка: «Не удалось разобрать позиции…».
 */
export function useDictation(onText: (text: string) => string | undefined) {
  const [Recognition] = useState(recognitionConstructor);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const session = useRef<ReturnType<typeof startRecognition> | null>(null);
  const callback = useRef(onText);
  useEffect(() => {
    callback.current = onText;
  });
  useEffect(() => () => session.current?.abort(), []);
  function start() {
    if (!Recognition) return;
    setError('');
    setInterim('');
    if (!navigator.onLine) {
      setError(OFFLINE_MESSAGE);
      return;
    }
    let failed = false;
    try {
      session.current = startRecognition(Recognition, {
        onInterim: setInterim,
        onError: (message) => {
          failed = true;
          setError(message);
        },
        onEnd: (text) => {
          session.current = null;
          setListening(false);
          setInterim('');
          // После ошибки пустой итог ничего не значит: сообщение об ошибке уже показано.
          const rejection = failed && !text ? undefined : callback.current(text);
          if (rejection) setError(rejection);
          setAnnouncement(
            text && !rejection ? 'Запись остановлена, текст добавлен' : 'Запись остановлена',
          );
        },
      });
      setListening(true);
      setAnnouncement('Идёт запись, говорите');
    } catch (failure) {
      // Браузер отказал до начала записи: например, распознаватель уже занят.
      session.current = null;
      setListening(false);
      setError(
        voiceErrorMessage(
          failure instanceof DOMException && failure.name === 'NotAllowedError'
            ? 'not-allowed'
            : 'unknown',
        ),
      );
    }
  }
  /** Прерывает запись без итога: поздний результат уже никуда не попадёт. */
  function abort() {
    if (!session.current) return;
    session.current.abort();
    session.current = null;
    setListening(false);
    setInterim('');
    setAnnouncement('Запись прервана');
  }
  return {
    supported: Recognition !== null,
    listening,
    interim,
    error,
    announcement,
    toggle: () => (session.current ? session.current.stop() : start()),
    abort,
  };
}

/**
 * Кнопка микрофона: 44 px, постоянное имя «Надиктовать»; запись видна по `aria-pressed`,
 * значку и строке «Идёт запись», а объявляется через `aria-live` в `DictationStatus`.
 */
export function DictationButton({
  dictation,
  disabled = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
}) {
  if (!dictation.supported) return null;
  return (
    <button
      type="button"
      className={`icon-button voice-button${dictation.listening ? ' voice-button--on' : ''}`}
      aria-pressed={dictation.listening}
      aria-label="Надиктовать"
      disabled={disabled}
      onClick={dictation.toggle}
    >
      {dictation.listening ? (
        <Stop size={20} weight="fill" aria-hidden />
      ) : (
        <Microphone size={22} aria-hidden />
      )}
    </button>
  );
}

/** Живой текст записи, объявление о начале и конце и понятная ошибка. */
export function DictationStatus({ dictation }: { dictation: Dictation }) {
  if (!dictation.supported) return null;
  return (
    <>
      <div className="visually-hidden voice-announcement" aria-live="polite">
        {dictation.announcement}
      </div>
      {dictation.listening ? (
        <div className="voice-status">
          <span className="voice-status__dot" aria-hidden />
          <span>
            <strong>Идёт запись</strong>
            {dictation.interim ? `: ${dictation.interim}` : ' — говорите'}
          </span>
        </div>
      ) : null}
      {dictation.error ? <Notice error>{dictation.error}</Notice> : null}
    </>
  );
}
