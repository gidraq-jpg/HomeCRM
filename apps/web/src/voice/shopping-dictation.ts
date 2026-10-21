// SHOP-4: разбор надиктованного списка покупок без ИИ. Правила простые и предсказуемые:
// - позиции делятся запятыми, точкой с запятой, точками и словами «и», «ещё», «а также», «потом»,
//   «плюс», стоящими отдельным словом; поэтому «хлеб и соль» — две позиции, а «хлеб-соль» — одна;
// - запятая или точка между цифрами — дробь («1,5 кг»), а не разделитель;
// - количество берётся только в начале позиции: число цифрами или словом, «пару», «десяток»,
//   «два десятка», затем необязательная единица («кг», «литр», «пачки», «батон»…);
// - первое слово после количества ставится в именительный падеж по короткому словарю
//   («яиц» → «яйца»), остальное остаётся как сказано.
import { plural } from '../ui/format.ts';

export type ShoppingDraft = { title: string; quantity?: string };

const TITLE_LIMIT = 200;

const NUMBERS: Record<string, number> = {
  один: 1,
  одна: 1,
  одно: 1,
  одну: 1,
  два: 2,
  две: 2,
  пару: 2,
  пара: 2,
  парочку: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  десяток: 10,
  дюжину: 12,
  дюжина: 12,
  двенадцать: 12,
  пятнадцать: 15,
  двадцать: 20,
};

/** «десяток» после числа: «два десятка» — 20. */
const TENS = new Set(['десяток', 'десятка', 'десятков']);

type Unit = {
  /** Короткая подпись или три формы слова для количества. */
  label: string | readonly [string, string, string];
  /** Название позиции, если, кроме количества, ничего не сказано: «три батона». */
  noun?: string;
};

const KG: Unit = { label: 'кг' };
const GRAM: Unit = { label: 'г' };
const LITRE: Unit = { label: 'л' };
const ML: Unit = { label: 'мл' };
const PIECE: Unit = { label: 'шт.' };
const pack: Unit = { label: ['пачка', 'пачки', 'пачек'] };
const loaf: Unit = { label: ['батон', 'батона', 'батонов'], noun: 'Батон' };
const bottle: Unit = { label: ['бутылка', 'бутылки', 'бутылок'] };
const jar: Unit = { label: ['банка', 'банки', 'банок'] };
const box: Unit = { label: ['коробка', 'коробки', 'коробок'] };
const bag: Unit = { label: ['пакет', 'пакета', 'пакетов'] };
const wrap: Unit = { label: ['упаковка', 'упаковки', 'упаковок'] };
const bunch: Unit = { label: ['пучок', 'пучка', 'пучков'] };

const UNITS: Record<string, Unit> = {
  кг: KG,
  кило: KG,
  килограмм: KG,
  килограмма: KG,
  килограммов: KG,
  г: GRAM,
  гр: GRAM,
  грамм: GRAM,
  грамма: GRAM,
  граммов: GRAM,
  л: LITRE,
  литр: LITRE,
  литра: LITRE,
  литров: LITRE,
  мл: ML,
  миллилитров: ML,
  шт: PIECE,
  штука: PIECE,
  штуку: PIECE,
  штуки: PIECE,
  штук: PIECE,
  пачка: pack,
  пачку: pack,
  пачки: pack,
  пачек: pack,
  батон: loaf,
  батона: loaf,
  батонов: loaf,
  бутылка: bottle,
  бутылку: bottle,
  бутылки: bottle,
  бутылок: bottle,
  банка: jar,
  банку: jar,
  банки: jar,
  банок: jar,
  коробка: box,
  коробку: box,
  коробки: box,
  коробок: box,
  пакет: bag,
  пакета: bag,
  пакетов: bag,
  упаковка: wrap,
  упаковку: wrap,
  упаковки: wrap,
  упаковок: wrap,
  пучок: bunch,
  пучка: bunch,
  пучков: bunch,
};

/** Частые продукты после количества: «два десятка яиц» → «Яйца». */
const NOMINATIVE: Record<string, string> = {
  яиц: 'яйца',
  яйца: 'яйца',
  яблок: 'яблоки',
  яблока: 'яблоки',
  огурцов: 'огурцы',
  огурца: 'огурцы',
  помидоров: 'помидоры',
  помидора: 'помидоры',
  бананов: 'бананы',
  банана: 'бананы',
  апельсинов: 'апельсины',
  апельсина: 'апельсины',
  лимонов: 'лимоны',
  лимона: 'лимоны',
  картошки: 'картошка',
  картофеля: 'картофель',
  моркови: 'морковь',
  морковки: 'морковка',
  лука: 'лук',
  чеснока: 'чеснок',
  молока: 'молоко',
  кефира: 'кефир',
  творога: 'творог',
  сметаны: 'сметана',
  йогуртов: 'йогурты',
  йогурта: 'йогурты',
  сыра: 'сыр',
  масла: 'масло',
  хлеба: 'хлеб',
  сахара: 'сахар',
  муки: 'мука',
  соли: 'соль',
  риса: 'рис',
  гречки: 'гречка',
  макарон: 'макароны',
  мяса: 'мясо',
  фарша: 'фарш',
  курицы: 'курица',
  сосисок: 'сосиски',
  пельменей: 'пельмени',
  воды: 'вода',
  сока: 'сок',
  чая: 'чай',
  кофе: 'кофе',
  салфеток: 'салфетки',
  батареек: 'батарейки',
};

/** Слова-просьбы в начале фразы: «купить молоко и хлеб». */
const LEAD = /^\s*(?:(?:нужно|надо|ещё|еще)\s+)?(?:купить|купи|взять|возьми)(?:\s*:)?\s+/iu;

/**
 * Разделители позиций. Запятая и точка между цифрами — дробь. Слова-разделители стоят
 * отдельно: перед ними пробел, после — пробел или конец строки.
 */
const SEPARATOR = /(?<!\d)[,.]|[,.](?!\d)|[;!?\n]|\s(?:и|ещё|еще|а\s+также|потом|плюс)(?=\s|$)/iu;

function parseNumber(word: string): number | null {
  if (/^\d+(?:[.,]\d+)?$/u.test(word)) return Number(word.replace(',', '.'));
  return NUMBERS[word] ?? null;
}

function formatNumber(value: number) {
  return String(value).replace('.', ',');
}

function unitText(unit: Unit, value: number) {
  if (typeof unit.label === 'string') return `${formatNumber(value)} ${unit.label}`;
  // Дробь читается с родительным падежом: «1,5 пачки».
  const form = Number.isInteger(value) ? plural(value, unit.label) : unit.label[1];
  return `${formatNumber(value)} ${form}`;
}

function capitalize(text: string) {
  return text.slice(0, 1).toLocaleUpperCase('ru') + text.slice(1);
}

function parseItem(part: string): ShoppingDraft | null {
  const words = part.split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const lower = words.map((word) => word.toLocaleLowerCase('ru').replace(/[«»"]/gu, ''));
  let index = 0;
  let value = parseNumber(lower[0] ?? '');
  const counted = value !== null;
  let unit: Unit | undefined;
  if (value !== null) {
    index = 1;
    if (lower[0] === 'десяток') unit = PIECE;
    else if (TENS.has(lower[1] ?? '')) {
      value *= 10;
      unit = PIECE;
      index = 2;
    }
  }
  const nextUnit = UNITS[lower[index] ?? ''];
  if (nextUnit && (value !== null || index === 0)) {
    unit = nextUnit;
    value ??= 1;
    index += 1;
  }
  const original = words.join(' ');
  if (value === null || value <= 0) return { title: capitalize(original).slice(0, TITLE_LIMIT) };
  const rest = words.slice(index);
  if (rest.length === 0) {
    // «три батона»: единица и есть позиция. «2 кг» или просто «батон» оставляем как сказано.
    if (counted && unit?.noun) return { title: unit.noun, quantity: `${formatNumber(value)} шт.` };
    return { title: capitalize(original).slice(0, TITLE_LIMIT) };
  }
  const first = lower[index] ?? '';
  const title = [NOMINATIVE[first] ?? rest[0], ...rest.slice(1)].join(' ');
  return {
    title: capitalize(title).slice(0, TITLE_LIMIT),
    quantity: unitText(unit ?? PIECE, value),
  };
}

/** Делит надиктованный текст на позиции. Пустые части и лишние разделители пропускаются. */
export function splitShoppingDictation(text: string): ShoppingDraft[] {
  const clean = text.replace(/\s+/gu, ' ').trim().replace(LEAD, '');
  if (!clean) return [];
  return ` ${clean} `
    .split(SEPARATOR)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .map(parseItem)
    .filter((item): item is ShoppingDraft => item !== null);
}
