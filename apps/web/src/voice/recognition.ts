// TASK-2, SHOP-4: диктовка через распознавание речи браузера (Web Speech API), русский язык.
// Звук уходит только в службу распознавания браузера; приложение его не хранит и не отправляет
// на свой сервер, распознанный текст не пишется в журналы.

/** То немногое из SpeechRecognition, чем пользуемся: в lib.dom он есть не во всех версиях. */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const OFFLINE_MESSAGE = 'Распознавание речи недоступно без интернета';

/** Конструктор распознавателя или null, если браузер его не поддерживает. */
export function recognitionConstructor(
  scope: object = globalThis,
): SpeechRecognitionConstructor | null {
  const candidate = scope as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/** Понятное сообщение по коду ошибки распознавания (PRD, раздел 13). */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Нет доступа к микрофону. Разрешите микрофон для этого сайта в настройках браузера.';
    case 'network':
      return OFFLINE_MESSAGE;
    case 'no-speech':
      return 'Ничего не расслышали. Нажмите на микрофон и скажите ещё раз.';
    case 'audio-capture':
      return 'Микрофон не найден или занят другим приложением.';
    case 'language-not-supported':
      return 'Браузер не распознаёт русскую речь. Введите текст вручную.';
    default:
      return 'Не удалось распознать речь. Скажите ещё раз или введите текст.';
  }
}

/** Распознанный текст дописывается к уже введённому через пробел. */
export function appendDictation(current: string, text: string): string {
  const addition = text.replace(/\s+/gu, ' ').trim();
  if (!addition) return current;
  const base = current.trimEnd();
  return base ? `${base} ${addition}` : addition;
}

export type RecognitionHandlers = {
  /** Живой текст во время записи: уже распознанное и предварительное. */
  onInterim: (text: string) => void;
  /** Конец записи; text — итог фразы, пустой, если ничего не распознано. */
  onEnd: (text: string) => void;
  onError: (message: string) => void;
};

/**
 * Одна запись — одна фраза: `continuous = false`, браузер сам останавливается после паузы.
 * Второе нажатие вызывает `stop()`, и итог приходит в `onEnd`.
 */
export function startRecognition(
  Recognition: SpeechRecognitionConstructor,
  handlers: RecognitionHandlers,
) {
  const recognition = new Recognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let final = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result) continue;
      if (result.isFinal) final = appendDictation(final, result[0].transcript);
      else interim = appendDictation(interim, result[0].transcript);
    }
    handlers.onInterim(appendDictation(final, interim));
  };
  recognition.onerror = (event) => {
    // «aborted» — это наша же отмена при закрытии экрана, сообщать не о чем.
    if (event.error !== 'aborted') handlers.onError(voiceErrorMessage(event.error));
  };
  recognition.onend = () => handlers.onEnd(final);
  recognition.start();
  return {
    stop: () => recognition.stop(),
    abort: () => {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    },
  };
}
