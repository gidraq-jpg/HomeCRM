import { describe, expect, it } from 'vitest';
import { SEED_RECORDS, TODAY } from './data/index.ts';
import {
  buildSearchEntries,
  countResults,
  matches,
  searchEntries,
  stem,
  tokenize,
} from './search.ts';

const entries = buildSearchEntries(SEED_RECORDS, TODAY);
const titles = (query: string, scope: 'all' | 'shared' | 'personal' = 'all') =>
  searchEntries(entries, query, scope).flatMap((group) =>
    group.entries.map((entry) => entry.title),
  );

describe('разбор слов', () => {
  it('приводит к нижнему регистру, заменяет «ё», режет по знакам', () => {
    expect(tokenize('Берёзовая, дача-17!')).toEqual(['березовая', 'дача', '17']);
  });

  it('основа отбрасывает окончание, но не трогает короткие слова', () => {
    expect(stem('страховка')).toBe('страхов');
    expect(stem('страховку')).toBe('страхов');
    expect(stem('дачи')).toBe('дач');
    expect(stem('уж')).toBe('уж');
  });
});

describe('поиск по вымышленным данным', () => {
  it('«страховка дачи» находит страховку дачи, а не страховку квартиры', () => {
    const found = titles('страховка дачи');
    expect(found).toContain('Страховка дачи');
    expect(found).not.toContain('Страховка квартиры на Садовой');
  });

  it('понимает словоформы: «страховку дачи», «страхование дачи»', () => {
    expect(titles('страховку дачи')).toContain('Страховка дачи');
    expect(titles('страхование дачи')).toContain('Страховка дачи');
  });

  it('«сантехник» находит мастера и показывает телефон для копирования', () => {
    const groups = searchEntries(entries, 'сантехник', 'all');
    const plumber = groups
      .flatMap((group) => group.entries)
      .find((entry) => entry.id === 'plumber');
    expect(plumber?.title).toBe('Пётр Семёнов');
    expect(plumber?.subtitle).toContain('+7 (900) 555-01-23');
    expect(plumber?.copy).toEqual({ what: 'телефон', value: '+7 (900) 555-01-23' });
  });

  it('находит по части номера телефона и по номеру лицевого счёта', () => {
    expect(titles('555-01-23')).toContain('Пётр Семёнов');
    expect(titles('0123')).toContain('Пётр Семёнов');
    expect(titles('4012-557')).toContain('Содержание и ремонт (ЕПД), лицевой счёт');
  });

  it('запрос из нескольких слов требует их все', () => {
    expect(titles('лицевой садовая свет')).toEqual([]);
    expect(titles('лицевой садовая электроэнергия')).toContain('Электроэнергия, лицевой счёт');
  });

  it('находит по части слова: «паспорт» — и «загранпаспорт»', () => {
    expect(titles('паспорт')).toContain('Загранпаспорт');
    expect(titles('нагреват')).toContain('Гарантия на водонагреватель');
    // Совсем короткие основы ищутся только с начала слова: «тра» не находит «Страховка».
    expect(titles('тра')).not.toContain('Страховка дачи');
  });

  it('пустой и пробельный запрос ничего не ищет', () => {
    expect(searchEntries(entries, '', 'all')).toEqual([]);
    expect(searchEntries(entries, '   ', 'all')).toEqual([]);
  });

  it('результаты сгруппированы по типам в заданном порядке', () => {
    const groups = searchEntries(entries, 'дача', 'all').map((group) => group.group);
    const order = ['home', 'documents', 'people', 'tasks', 'notes', 'shopping'];
    expect(groups).toEqual([...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it('matches работает на отдельных записях', () => {
    const dacha = entries.find((entry) => entry.id === 'sosnovka');
    expect(dacha && matches(dacha, 'сосновка')).toBe(true);
    expect(dacha && matches(dacha, 'квартира')).toBe(false);
  });
});

describe('поиск и переключатель «Всё · Общее · Личное»', () => {
  it('личная запись находится в «Всё» и «Личное», но не в «Общее»', () => {
    expect(titles('загранпаспорт', 'all')).toContain('Загранпаспорт');
    expect(titles('загранпаспорт', 'personal')).toContain('Загранпаспорт');
    expect(titles('загранпаспорт', 'shared')).toEqual([]);
  });

  it('общая запись не находится в режиме «Личное»', () => {
    expect(titles('сантехник', 'personal')).toEqual([]);
    expect(titles('сантехник', 'shared')).toContain('Пётр Семёнов');
  });

  it('число совпадений вне режима можно посчитать, чтобы предложить «Всё»', () => {
    const inPersonal = countResults(searchEntries(entries, 'сантехник', 'personal'));
    const inAll = countResults(searchEntries(entries, 'сантехник', 'all'));
    expect(inPersonal).toBe(0);
    expect(inAll).toBeGreaterThan(0);
  });

  it('лицевые счета и счётчики наследуют доступ объекта', () => {
    const personal = searchEntries(entries, 'лицевой счёт', 'personal');
    expect(personal).toEqual([]);
  });
});
