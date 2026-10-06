import { describe, expect, it } from 'vitest';
import { ApiError } from '../auth/api.ts';
import {
  householdErrorMessage,
  isResponsibilityPending,
  isSecondFactorRequired,
} from './errors.ts';

describe('тексты ошибок состава дома', () => {
  it('последний администратор: при уходе и при смене роли — разные подсказки', () => {
    const error = new ApiError(409, 'LAST_ADMIN');
    expect(householdErrorMessage(error, 'leave')).toContain('единственный администратор');
    expect(householdErrorMessage(error, 'role')).toContain('хотя бы один администратор');
  });

  it('конфликт роли объясняет про записи «Взрослые»', () => {
    expect(householdErrorMessage(new ApiError(409, 'CONFLICT'), 'role')).toContain(
      'записи «Взрослые»',
    );
    expect(householdErrorMessage(new ApiError(409, 'CONFLICT'), 'exclude')).toContain(
      'Обновите страницу',
    );
  });

  it('второй фактор — объяснение, а не «ошибка входа»', () => {
    const error = new ApiError(403, 'SECOND_FACTOR_REQUIRED');
    expect(isSecondFactorRequired(error)).toBe(true);
    expect(householdErrorMessage(error, 'reset')).toContain('со вторым фактором');
    expect(householdErrorMessage(error, 'reset')).not.toContain('Вход с кодом');
  });

  it('503 RESPONSIBILITY_PENDING — отдельный случай, сам по себе не ошибка', () => {
    expect(isResponsibilityPending(new ApiError(503, 'RESPONSIBILITY_PENDING'))).toBe(true);
    expect(isResponsibilityPending(new ApiError(503, 'WORKER_UNAVAILABLE'))).toBe(false);
    expect(householdErrorMessage(new ApiError(503, 'WORKER_UNAVAILABLE'), 'leave')).toContain(
      'Ничего не изменилось',
    );
  });

  it('сброс пароля: взрослому нельзя; остальное недоступно не-администратору', () => {
    expect(householdErrorMessage(new ApiError(403, 'RESET_NOT_ALLOWED'), 'reset')).toContain(
      'только ребёнку',
    );
    expect(householdErrorMessage(new ApiError(403, 'ACCESS_DENIED'), 'role')).toContain(
      'только администратору',
    );
  });

  it('технические тексты сервера не показываются', () => {
    const text = householdErrorMessage(new ApiError(500, 'INTERNAL_ERROR'), 'role');
    expect(text).not.toContain('INTERNAL');
    expect(householdErrorMessage(new ApiError(0, 'NETWORK'), 'load')).toContain('подключение');
  });
});
