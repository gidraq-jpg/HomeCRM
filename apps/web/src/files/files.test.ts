import { describe, expect, it } from 'vitest';
import { ApiError } from '../auth/api.ts';
import { fileErrorMessage } from './errors.ts';
import {
  classify,
  fitSize,
  localProblem,
  MAX_FILE_BYTES,
  MAX_SIDE,
  withExtension,
} from './prepare.ts';
import { formatFileSize } from './size.ts';

const NBSP = String.fromCodePoint(0xa0);

describe('classify', () => {
  it('узнаёт фото и PDF по типу', () => {
    expect(classify({ name: 'a', type: 'image/jpeg' })).toBe('image');
    expect(classify({ name: 'a', type: 'image/heic' })).toBe('image');
    expect(classify({ name: 'a', type: 'application/pdf' })).toBe('pdf');
  });

  it('без типа смотрит на расширение, например у HEIC с телефона', () => {
    expect(classify({ name: 'IMG_0001.HEIC', type: '' })).toBe('image');
    expect(classify({ name: 'квитанция.pdf', type: '' })).toBe('pdf');
  });

  it('отклоняет остальное, даже с подходящим расширением и чужим типом', () => {
    expect(classify({ name: 'заметки.txt', type: 'text/plain' })).toBeNull();
    expect(classify({ name: 'a.gif', type: 'image/gif' })).toBeNull();
    expect(classify({ name: 'фото.jpg', type: 'text/plain' })).toBeNull();
    expect(classify({ name: 'без-расширения', type: '' })).toBeNull();
  });
});

describe('localProblem', () => {
  const pdf = { name: 'a.pdf', type: 'application/pdf' };

  it('предел — 25 МиБ включительно', () => {
    expect(localProblem({ ...pdf, size: MAX_FILE_BYTES })).toBeNull();
    expect(localProblem({ ...pdf, size: MAX_FILE_BYTES + 1 })).toBe('size');
  });

  it('пустой файл и чужой формат называются отдельно', () => {
    expect(localProblem({ ...pdf, size: 0 })).toBe('empty');
    expect(localProblem({ name: 'a.txt', type: 'text/plain', size: 10 })).toBe('type');
  });
});

describe('fitSize', () => {
  it('не трогает фото, которое и так не больше 2560 px', () => {
    expect(fitSize(2560, 1440)).toEqual({ width: 2560, height: 1440 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('уменьшает по длинной стороне и сохраняет пропорции', () => {
    expect(fitSize(5120, 2880)).toEqual({ width: MAX_SIDE, height: 1440 });
    expect(fitSize(3000, 4000)).toEqual({ width: 1920, height: MAX_SIDE });
  });

  it('никогда не даёт нулевую сторону', () => {
    expect(fitSize(100_000, 1)).toEqual({ width: MAX_SIDE, height: 1 });
  });
});

describe('withExtension', () => {
  it('меняет расширение и не ломает имена без него', () => {
    expect(withExtension('снимок.webp', 'jpg')).toBe('снимок.jpg');
    expect(withExtension('архив.2026.heic', 'jpg')).toBe('архив.2026.jpg');
    expect(withExtension('снимок', 'jpg')).toBe('снимок.jpg');
  });
});

describe('formatFileSize', () => {
  it('пишет размер по-русски, с запятой', () => {
    expect(formatFileSize(512)).toBe(`512${NBSP}Б`);
    expect(formatFileSize(340 * 1024)).toBe(`340${NBSP}КБ`);
    expect(formatFileSize(Math.round(2.4 * 1024 * 1024))).toBe(`2,4${NBSP}МБ`);
    expect(formatFileSize(MAX_FILE_BYTES)).toBe(`25,0${NBSP}МБ`);
  });
});

describe('fileErrorMessage', () => {
  it('413 и 415 объясняются понятными словами без технических деталей', () => {
    expect(fileErrorMessage(new ApiError(413, 'FILE_TOO_LARGE'), 'upload')).toContain('25 МБ');
    const unsupported = fileErrorMessage(new ApiError(415, 'UNSUPPORTED_FILE'), 'upload');
    expect(unsupported).toContain('PDF');
    expect(unsupported).not.toContain('UNSUPPORTED_FILE');
  });

  it('отказ в правах зависит от действия', () => {
    expect(fileErrorMessage(new ApiError(403), 'trash')).toContain('корзину');
    expect(fileErrorMessage(new ApiError(403), 'restore')).toContain('автор');
    expect(fileErrorMessage(new ApiError(403), 'upload')).toContain('Добавлять');
  });

  it('сеть и неизвестные сбои — общие тексты', () => {
    expect(fileErrorMessage(new ApiError(0, 'NETWORK'), 'upload')).toContain('подключение');
    expect(fileErrorMessage(new Error('boom'), 'upload')).not.toContain('boom');
  });
});
