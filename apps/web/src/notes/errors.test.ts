import { describe, expect, it } from 'vitest';
import { ApiError } from '../auth/api.ts';
import { isStaleVersion, noteErrorMessage } from './errors.ts';

describe('тексты ошибок заметок', () => {
  it('конфликт версии отличается от общего конфликта', () => {
    expect(isStaleVersion(new ApiError(409, 'STALE_VERSION'))).toBe(true);
    expect(isStaleVersion(new ApiError(409, 'CONFLICT'))).toBe(false);
    expect(noteErrorMessage(new ApiError(409, 'STALE_VERSION'), 'save')).toContain('изменили');
  });

  it('каждое объяснение говорит, что делать дальше', () => {
    expect(noteErrorMessage(new ApiError(403, 'ACCESS_DENIED'), 'personal')).toContain(
      'Скопируйте её в личное',
    );
    expect(noteErrorMessage(new ApiError(409, 'ASSIGNEE_CANNOT_SEE'), 'audience')).toContain(
      'ответственным взрослого',
    );
    expect(noteErrorMessage(new ApiError(404, 'NOT_FOUND'), 'load')).toContain('обновите');
    expect(noteErrorMessage(new ApiError(400, 'INVALID_INPUT'), 'save')).toContain('200 знаков');
    expect(noteErrorMessage(new ApiError(500, 'INTERNAL_ERROR'), 'load')).toContain('подключение');
  });

  it('технический код сервера не попадает в текст', () => {
    for (const action of ['save', 'trash', 'share'] as const) {
      const text = noteErrorMessage(new ApiError(403, 'ACCESS_DENIED'), action);
      expect(text).not.toContain('ACCESS_DENIED');
    }
  });
});
