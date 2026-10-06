import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks, safeHref } from './markdown.tsx';

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('безопасные ссылки', () => {
  it('разрешает только http, https, mailto и tel', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com/')).toBe('http://example.com/');
    expect(safeHref('mailto:anna@example.com')).toBe('mailto:anna@example.com');
    expect(safeHref('tel:+79005550123')).toBe('tel:+79005550123');
  });

  it('отвергает всё остальное, в том числе обходы', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'file:///etc/passwd',
      '/относительный/путь',
      '//example.com',
      '',
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe('Markdown заметки', () => {
  it('рисует абзацы, заголовки, списки, выделение и код', () => {
    const out = html(
      [
        '# Список дел',
        '',
        'Первая строка',
        'и вторая, **важно** и *очень*.',
        '',
        '- хлеб',
        '- молоко',
        '',
        '1. раз',
        '2. два',
        '',
        'Команда `ls -la`.',
      ].join('\n'),
    );
    expect(out).toContain('<h2>Список дел</h2>');
    expect(out).toContain('Первая строка<br/>и вторая');
    expect(out).toContain('<strong>важно</strong>');
    expect(out).toContain('<em>очень</em>');
    expect(out).toContain('<ul><li>хлеб</li><li>молоко</li></ul>');
    expect(out).toContain('<ol><li>раз</li><li>два</li></ol>');
    expect(out).toContain('<code>ls -la</code>');
  });

  it('сырой HTML выводится текстом и не выполняется', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>жирный</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('ссылки: безопасные — со ссылкой, чужие протоколы — только подпись', () => {
    const out = html(
      '[сайт](https://example.com) и [бяка](javascript:alert(1)) и [почта](mailto:a@b.ru)',
    );
    expect(out).toContain(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer nofollow">сайт</a>',
    );
    expect(out).toContain('href="mailto:a@b.ru"');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('бяка');
  });

  it('голые адреса становятся ссылками без хвостовой точки', () => {
    const out = html('Смотри https://example.com/path. Потом.');
    expect(out).toContain('href="https://example.com/path"');
    expect(out).toContain('>https://example.com/path</a>. Потом.');
  });

  it('картинки не загружаются: остаётся подпись', () => {
    const out = html('![схема](https://example.com/a.png)');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('src=');
    expect(out).toContain('схема');
  });

  it('экранирование и подчёркивания внутри слов', () => {
    const out = html('\\*не выделено\\* и snake_case_name');
    expect(out).toContain('*не выделено*');
    expect(out).toContain('snake_case_name');
    expect(out).not.toContain('<em>');
  });

  it('блок кода и цитата', () => {
    const out = html(['```', '<b>код</b>', '```', '', '> цитата'].join('\n'));
    expect(out).toContain('<pre><code>&lt;b&gt;код&lt;/b&gt;</code></pre>');
    expect(out).toContain('<blockquote><p>цитата</p></blockquote>');
  });

  it('очень длинный текст из скобок и звёздочек разбирается быстро', () => {
    const started = performance.now();
    html(`${'[*_'.repeat(30_000)}`);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('разбирает пустой текст в ноль блоков', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n  \n')).toEqual([]);
  });
});
