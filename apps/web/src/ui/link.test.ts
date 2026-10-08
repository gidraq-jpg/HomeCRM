import { describe, expect, it } from 'vitest';
import { MAX_LINK, parseLink } from './link.ts';

describe('ссылки в формах', () => {
  it('пустая строка — ссылки нет', () => {
    expect(parseLink('  ')).toEqual({ ok: true, url: null });
  });

  it('адрес без схемы дополняется https://', () => {
    expect(parseLink('supplier.invalid/cabinet')).toEqual({
      ok: true,
      url: 'https://supplier.invalid/cabinet',
    });
    expect(parseLink('http://supplier.invalid')).toEqual({
      ok: true,
      url: 'http://supplier.invalid',
    });
  });

  it('чужие схемы, слова без точки и слишком длинные адреса отклоняются', () => {
    for (const bad of ['javascript://alert', 'ftp://host.example', 'просто слова', 'hello'])
      expect(parseLink(bad), bad).toEqual({ ok: false });
    expect(parseLink(`https://a.example/${'x'.repeat(MAX_LINK)}`)).toEqual({ ok: false });
  });
});
