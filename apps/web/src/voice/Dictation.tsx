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
 */
export function useDictation(onText: (text: string) => void) {
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
    try {
      session.current = startRecognition(Recognition, {
        onInterim: setInterim,
        onError: setError,
        onEnd: (text) => {
          session.current = null;
          setListening(false);
          setInterim('');
          setAnnouncement(text ? 'Запись остановлена, текст добавлен' : 'Запись остановлена');
          if (text) callback.current(text);
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
  return {
    supported: Recognition !== null,
    listening,
    interim,
    error,
    announcement,
    toggle: () => (session.current ? session.current.stop() : start()),
  };
}

/** Кнопка микрофона: 44 px, имя и значок меняются вместе с `aria-pressed`. */
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
      aria-label={dictation.listening ? 'Остановить запись' : 'Надиктовать'}
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
      <p className="visually-hidden voice-announcement" aria-live="polite">
        {dictation.announcement}
      </p>
      {dictation.listening ? (
        <p className="voice-status">
          <span className="voice-status__dot" aria-hidden />
          <span>
            <strong>Идёт запись</strong>
            {dictation.interim ? `: ${dictation.interim}` : ' — говорите'}
          </span>
        </p>
      ) : null}
      {dictation.error ? <Notice error>{dictation.error}</Notice> : null}
    </>
  );
}
