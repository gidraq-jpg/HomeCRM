import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PrototypeApp } from './PrototypeApp.tsx';

function render(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <PrototypeApp />
    </MemoryRouter>,
  );
}

// Разметка из renderToString разделяет соседние тексты комментариями React — убираем их.
const text = (html: string) => html.replaceAll('<!-- -->', '');

describe('PrototypeApp', () => {
  it('рисует пять разделов нижнего меню', () => {
    const html = text(render('/today'));
    for (const label of ['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']) {
      expect(html).toContain(`<span class="bottom-nav__label">${label}</span>`);
    }
  });

  it('в шапке — переключатель «Всё · Общее · Личное», по умолчанию выбрано «Всё»', () => {
    const html = text(render('/today'));
    const inputs = html.match(/<input type="radio" name="scope"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    const checked = inputs.filter((input) => input.includes('checked'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="all"');
    expect(html).toContain('<span class="scope-switch__label">Всё</span>');
    expect(html).toContain('<span class="scope-switch__label">Общее</span>');
    expect(html).toContain('<span class="scope-switch__label">Личное</span>');
  });

  it('кнопка «+» и поиск есть на экране', () => {
    const html = text(render('/today'));
    expect(html).toContain('aria-label="Добавить"');
    expect(html).toContain('aria-label="Поиск"');
  });

  it('«Сегодня» показывает главное дело и окно показаний', () => {
    const html = text(render('/today'));
    expect(html).toContain('Главное на сегодня');
    expect(html).toContain('Открыто окно показаний');
    expect(html).toContain('Квартира на Садовой');
  });

  it('все разделы рисуются без ошибок', () => {
    const paths = [
      '/today/plan',
      '/today/all',
      '/home',
      '/home/month',
      '/home/sadovaya',
      '/home/sadovaya/utilities',
      '/home/sadovaya/meters',
      '/home/sadovaya/documents',
      '/home/sadovaya/people',
      '/home/sadovaya/feed',
      '/home/sadovaya/readings',
      '/documents',
      '/documents/doc-dacha-insurance',
      '/people',
      '/people/plumber',
      '/more',
      '/more/notes',
      '/more/notes/note-gifts',
      '/more/shopping',
      '/more/radar',
      '/more/settings',
      '/more/trash',
      '/more/export',
      '/more/spaces',
      '/search?q=страховка',
    ];
    for (const path of paths) {
      const html = text(render(path));
      expect(html, path).toContain('<h1');
      expect(html, path).not.toContain('Страница не найдена');
    }
  });

  it('несуществующий адрес и несуществующая запись — понятное сообщение', () => {
    expect(text(render('/нет-такого'))).toContain('Страница не найдена');
    expect(text(render('/documents/нет'))).toContain('Документ не найден');
  });
});
