import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig, type TrustProxy } from './config.ts';

describe('GET /health', () => {
  it('отвечает ok и версией', async () => {
    const app = buildApp({ LOG_LEVEL: 'silent', APP_VERSION: 'test' });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', version: 'test' });
    await app.close();
  });
});

describe('loadConfig', () => {
  it('по умолчанию слушает только 127.0.0.1 и порт разработки', () => {
    expect(loadConfig({})).toMatchObject({ HOST: '127.0.0.1', PORT: 8310 });
  });

  it('отклоняет неверный порт', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });

  it('TRUST_PROXY: по умолчанию никому не верит; принимает true и список адресов', () => {
    expect(loadConfig({}).TRUST_PROXY).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ TRUST_PROXY: 'loopback, 10.0.0.0/8' }).TRUST_PROXY).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
    expect(() => loadConfig({ TRUST_PROXY: 'ya.ru; drop' })).toThrow();
    expect(() => loadConfig({ TRUST_PROXY: '2' })).toThrow();
  });
});

describe('trustProxy (AUTH-8)', () => {
  const clientOf = async (trustProxy?: TrustProxy) => {
    const app = buildApp({
      LOG_LEVEL: 'silent',
      APP_VERSION: 'test',
      ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
    });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    await app.close();
    return response.json<{ ip: string }>().ip;
  };

  it('без доверенного прокси адрес — с которого пришло соединение, присланный заголовок не в счёт', async () => {
    expect(await clientOf()).toBe('10.0.0.5');
    expect(await clientOf(false)).toBe('10.0.0.5');
  });

  it('за доверенным прокси адрес клиента — из X-Forwarded-For: у разных клиентов он разный', async () => {
    expect(await clientOf(true)).toBe('203.0.113.7');
    expect(await clientOf(['10.0.0.0/8'])).toBe('203.0.113.7');
  });

  it('прокси не из списка не доверенный: заголовок не подменяет адрес', async () => {
    expect(await clientOf(['192.168.0.0/16'])).toBe('10.0.0.5');
  });
});
