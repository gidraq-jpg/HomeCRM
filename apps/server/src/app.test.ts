import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

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
});
