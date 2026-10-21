import { describe, expect, it, vi } from 'vitest';
import {
  appendDictation,
  OFFLINE_MESSAGE,
  recognitionConstructor,
  type SpeechRecognitionLike,
  type SpeechResultEvent,
  startRecognition,
  voiceErrorMessage,
} from './recognition.ts';

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 5;
  onresult: ((event: SpeechResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort = vi.fn();
}
const result = (transcript: string, isFinal: boolean) => ({ isFinal, 0: { transcript } });

describe('TASK-2: распознавание речи', () => {
  it('находит стандартный и webkit-конструктор, без них — null', () => {
    expect(recognitionConstructor({})).toBeNull();
    expect(recognitionConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(recognitionConstructor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
  });

  it('русский язык, одна фраза, живой текст и итог при остановке', () => {
    const onInterim = vi.fn();
    const onEnd = vi.fn();
    const session = startRecognition(FakeRecognition, { onInterim, onEnd, onError: vi.fn() });
    const recognition = FakeRecognition.last as FakeRecognition;
    expect(recognition).toMatchObject({
      lang: 'ru-RU',
      continuous: false,
      interimResults: true,
      started: true,
    });
    recognition.onresult?.({ resultIndex: 0, results: [result('позвонить', false)] });
    expect(onInterim).toHaveBeenLastCalledWith('позвонить');
    recognition.onresult?.({
      resultIndex: 0,
      results: [result('позвонить мастеру', true), result('завтра', false)],
    });
    expect(onInterim).toHaveBeenLastCalledWith('позвонить мастеру завтра');
    session.stop();
    expect(onEnd).toHaveBeenCalledWith('позвонить мастеру');
  });

  it('ошибки дают понятные сообщения, отмена молчит', () => {
    const onError = vi.fn();
    const session = startRecognition(FakeRecognition, {
      onInterim: vi.fn(),
      onEnd: vi.fn(),
      onError,
    });
    const recognition = FakeRecognition.last as FakeRecognition;
    recognition.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
    recognition.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(voiceErrorMessage('not-allowed'));
    session.abort();
    expect(recognition.abort).toHaveBeenCalled();
    expect(recognition.onend).toBeNull();
  });

  it('сообщения об ошибках на русском и различаются', () => {
    expect(voiceErrorMessage('network')).toBe(OFFLINE_MESSAGE);
    const codes = ['not-allowed', 'no-speech', 'audio-capture', 'network', 'other'];
    expect(new Set(codes.map(voiceErrorMessage)).size).toBe(codes.length);
    expect(voiceErrorMessage('not-allowed')).toContain('микрофон');
  });

  it('распознанное дописывается через пробел', () => {
    expect(appendDictation('', '  купить   хлеб ')).toBe('купить хлеб');
    expect(appendDictation('Позвонить ', 'завтра')).toBe('Позвонить завтра');
    expect(appendDictation('Позвонить', '   ')).toBe('Позвонить');
  });
});
