import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import type { Me } from './auth/api.ts';

function me(role: 'admin' | 'adult' | 'child' | null): Me {
  return {
    id: 'fictional-account',
    displayName: 'Борис',
    username: 'boris',
    email: null,
    twoFactorEnabled: false,
    secondFactorRequired: false,
    roles: role ? [{ householdId: 'fictional-home', role }] : [],
    timeZone: 'Asia/Yekaterinburg',
    passwordReset: null,
  };
}

function render(path: string, role: 'admin' | 'adult' | 'child' | null = 'adult'): string {
  const client = new QueryClient();
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App me={me(role)} reloadMe={async () => {}} signOut={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Разметка из renderToString разделяет соседние тексты комментариями React — убираем их.
const text = (html: string) => html.replaceAll('<!-- -->', '');

describe('рабочее приложение', () => {
  it('рисует пять разделов нижнего и бокового меню', () => {
    const html = text(render('/today'));
    for (const label of ['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']) {
      expect(html).toContain(`<span class="bottom-nav__label">${label}</span>`);
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(html).toContain('class="side-nav"');
  });

  it('в шапке — переключатель «Всё · Общее · Личное», по умолчанию «Всё», и поиск', () => {
    const html = text(render('/today'));
    const inputs = html.match(/<input type="radio" name="scope"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    expect(inputs.filter((input) => input.includes('checked'))).toHaveLength(1);
    expect(inputs.find((input) => input.includes('checked'))).toContain('value="all"');
    expect(html).toContain('aria-label="Поиск"');
    expect(html).toContain('aria-label="Добавить"');
  });

  it('вымышленных данных прототипа нет ни в одном разделе', () => {
    const paths = ['/today', '/home', '/documents', '/people', '/more', '/more/spaces', '/search'];
    for (const path of paths) {
      const html = text(render(path));
      expect(html, path).toContain('<h1');
      for (const marker of ['Орлов', 'Садовой', 'Сосновка', 'Страховка дачи', 'прототип']) {
        expect(html, `${path}: ${marker}`).not.toContain(marker);
      }
    }
  });

  it('разделы без данных честно говорят, что создавать пока нечего', () => {
    expect(text(render('/documents'))).toContain('Документов пока нет');
    expect(text(render('/today'))).toContain('Дел на сегодня пока нет');
  });

  it('«Дом»: экраны объектов открываются и ждут данные API', () => {
    expect(text(render('/home'))).toContain('Загружаем объекты');
    expect(text(render('/home/abc'))).toContain('Загружаем объект');
    // Форма создания: название — единственное обязательное поле, «Кто видит» над «Сохранить».
    const form = text(render('/home/new'));
    expect(form).toContain('Новый объект');
    expect(form.indexOf('Кто видит')).toBeLessThan(form.indexOf('>Сохранить<'));
    // Недвижимость по умолчанию — «Взрослые» (таблица 7.2 PRD).
    expect(form).toMatch(/value="adults"[^>]*checked|checked[^>]*value="adults"/);
    for (const value of ['personal', 'adults', 'household']) {
      expect(form).toContain(`value="${value}"`);
    }
  });

  it('ребёнку в форме объекта доступно только «Только я»', () => {
    const form = text(render('/home/new', 'child'));
    expect(form).toContain('value="personal"');
    expect(form).not.toContain('value="adults"');
    expect(form).not.toContain('value="household"');
  });

  it('администратор видит приглашение на «Сегодня»; взрослый и ребёнок — нет', () => {
    expect(text(render('/today', 'admin'))).toContain('Пригласить участника');
    for (const role of ['adult', 'child'] as const) {
      expect(text(render('/today', role))).not.toContain('Пригласить участника');
    }
  });

  it('без дома экран «Люди» объясняет, что делать', () => {
    expect(text(render('/people', null))).toContain('Вы не состоите в доме');
  });

  it('экран приглашения закрыт для не-администраторов', () => {
    expect(text(render('/people/invite', 'adult'))).toContain(
      'Пригласить нового участника в дом может только администратор',
    );
    expect(text(render('/people/invite', 'admin'))).toContain('Создать ссылку-приглашение');
  });

  it('«Ещё» ведёт в заметки и корзину; экраны заметок открываются и ждут данные API', () => {
    const more = text(render('/more'));
    expect(more).toContain('href="/more/notes"');
    expect(more).toContain('href="/more/trash"');
    expect(text(render('/more/notes'))).toContain('Загружаем заметки');
    expect(text(render('/more/trash'))).toContain('Загружаем корзину');
    expect(text(render('/more/notes/abc'))).toContain('Загружаем заметку');
    // Форма создания: строка «Кто видит» над «Сохранить», у взрослого — три значения.
    const form = text(render('/more/notes/new'));
    expect(form).toContain('Новая заметка');
    expect(form.indexOf('Кто видит')).toBeLessThan(form.indexOf('>Сохранить<'));
    for (const value of ['personal', 'adults', 'household']) {
      expect(form).toContain(`value="${value}"`);
    }
  });

  it('форма заметки не пишет ни в localStorage, ни в адрес: у страницы нет черновика вне памяти', () => {
    // На сервере (renderToString) хранилища нет: форма не должна обращаться к нему вообще.
    expect(() => render('/more/notes/new')).not.toThrow();
  });

  it('неизвестный адрес — понятное сообщение', () => {
    expect(text(render('/нет-такого'))).toContain('Страница не найдена');
  });
});
