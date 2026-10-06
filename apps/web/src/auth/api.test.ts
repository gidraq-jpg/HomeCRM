import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { ApiError, api, consumeLink, errorMessage, loginBody } from './api.ts';

afterEach(() => vi.unstubAllGlobals());
describe('граница входа', () => {
  it('отправляет ровно идентификатор выбранного маршрута', () => {
    expect(loginBody(' vera ', 'fictional')).toEqual({
      path: 'auth/sign-in/username',
      body: { username: 'vera', password: 'fictional' },
    });
    expect(loginBody(' adult@family.test ', 'fictional')).toEqual({
      path: 'auth/sign-in/email',
      body: { email: 'adult@family.test', password: 'fictional' },
    });
  });
  it('разбирает прямые ссылки и callback со hash', () => {
    expect(consumeLink(new URL('https://family.test/invite/fictional-link'))).toEqual({
      kind: 'invite',
      token: 'fictional-link',
    });
    expect(consumeLink(new URL('https://family.test/reset-password?token=fictional-link'))).toEqual(
      { kind: 'reset', token: 'fictional-link' },
    );
    expect(
      consumeLink(new URL('https://family.test/?token=fictional-link#/reset-password')),
    ).toEqual({ kind: 'reset', token: 'fictional-link' });
    expect(consumeLink(new URL('https://family.test/#/today'))).toBeNull();
    expect(consumeLink(new URL('https://family.test/invite/%ZZ'))).toEqual({
      kind: 'invite',
      token: null,
    });
    expect(consumeLink(new URL('https://family.test/#http://['))).toBeNull();
  });
  it('блокировка учитывает Retry-After; технический текст не показывается', () => {
    expect(errorMessage(new ApiError(429, '', 120))).toContain('через 2 мин.');
    expect(errorMessage(new Error('Failed query: private value'))).not.toContain('private value');
  });
  it('каждый запрос отключает HTTP-кэш и проверяет схему ответа', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"wrong":true}'));
    vi.stubGlobal('fetch', fetch);
    await expect(api('me', z.object({ id: z.string() }))).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });
});
