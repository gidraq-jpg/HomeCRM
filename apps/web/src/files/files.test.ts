import { describe, expect, it } from 'vitest';
import { ApiError } from '../auth/api.ts';
import { fileErrorMessage } from './errors.ts';
import {
  chooseUpload,
  classify,
  fitSize,
  localProblem,
  MAX_FILE_BYTES,
  MAX_SIDE,
  outputTypeFor,
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
    expect(formatFileSize(MAX_FILE_BYTES)).toBe(`25${NBSP}МБ`);
  });

  it('у границы килобайта и мегабайта не пишет «1023 КБ» и «1024 КБ»', () => {
    expect(formatFileSize(999 * 1024)).toBe(`999${NBSP}КБ`);
    expect(formatFileSize(1023 * 1024)).toBe(`1${NBSP}МБ`);
    expect(formatFileSize(1_048_000)).toBe(`1${NBSP}МБ`);
    expect(formatFileSize(1_048_500)).toBe(`1${NBSP}МБ`);
    expect(formatFileSize(1024 * 1024)).toBe(`1${NBSP}МБ`);
    expect(formatFileSize(1_500_000)).toBe(`1,4${NBSP}МБ`);
  });
});

describe('outputTypeFor', () => {
  it('PNG и WebP остаются собой, остальное уходит JPEG', () => {
    expect(outputTypeFor('image/png')).toBe('image/png');
    expect(outputTypeFor('image/webp')).toBe('image/webp');
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg');
    expect(outputTypeFor('image/heic')).toBe('image/jpeg');
    expect(outputTypeFor('')).toBe('image/jpeg');
  });
});

describe('chooseUpload', () => {
  const original = (type: string, name: string, size: number) =>
    new File([new Uint8Array(size)], name, { type });

  it('уменьшенный WebP остаётся WebP и не превращается в JPEG', () => {
    const chosen = chooseUpload(
      original('image/webp', 'логотип.webp', 5000),
      new Blob([new Uint8Array(1000)], { type: 'image/webp' }),
    );
    expect(chosen.type).toBe('image/webp');
    expect(chosen.name).toBe('логотип.webp');
    expect(chosen.size).toBe(1000);
  });

  it('если браузер не умеет кодировать WebP и отдал PNG, расширение следует за содержимым', () => {
    const chosen = chooseUpload(
      original('image/webp', 'логотип.webp', 5000),
      new Blob([new Uint8Array(1000)], { type: 'image/png' }),
    );
    expect(chosen.type).toBe('image/png');
    expect(chosen.name).toBe('логотип.png');
  });

  it('если уменьшенный файл не меньше исходного, уходит исходный', () => {
    const file = original('image/jpeg', 'снимок.jpg', 1000);
    expect(chooseUpload(file, new Blob([new Uint8Array(1001)], { type: 'image/jpeg' }))).toBe(file);
    expect(chooseUpload(file, new Blob([new Uint8Array(1000)], { type: 'image/jpeg' }))).toBe(file);
    expect(chooseUpload(file, new Blob([], { type: 'image/jpeg' }))).toBe(file);
    expect(chooseUpload(file, null)).toBe(file);
  });

  it('HEIC после уменьшения получает имя JPEG', () => {
    const chosen = chooseUpload(
      original('image/heic', 'IMG_0001.HEIC', 9000),
      new Blob([new Uint8Array(3000)], { type: 'image/jpeg' }),
    );
    expect(chosen.name).toBe('IMG_0001.jpg');
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

  it('для фото профиля формат называется без PDF, права — про владельца', () => {
    const unsupported = fileErrorMessage(new ApiError(415, 'UNSUPPORTED_FILE'), 'photo');
    expect(unsupported).toContain('HEIC');
    expect(unsupported).not.toContain('PDF');
    expect(fileErrorMessage(new ApiError(403), 'photo')).toContain('владелец');
    expect(fileErrorMessage(new ApiError(404), 'photo')).toContain('фото');
  });

  it('сеть и неизвестные сбои — общие тексты', () => {
    expect(fileErrorMessage(new ApiError(0, 'NETWORK'), 'upload')).toContain('подключение');
    expect(fileErrorMessage(new Error('boom'), 'upload')).not.toContain('boom');
  });
});
