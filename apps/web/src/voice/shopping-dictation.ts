// SHOP-4: разбор надиктованного списка покупок без ИИ. Правила простые и предсказуемые:
// - позиции делятся запятыми, точкой с запятой, точками и словами «и», «ещё», «а также», «потом»,
//   «плюс», стоящими отдельным словом; поэтому «хлеб и соль» — две позиции, а «хлеб-соль» — одна;
// - запятая или точка между цифрами — дробь («1,5 кг»), а не разделитель;
// - количество берётся в начале или после названия: число цифрами или словом, «пару», «десяток»,
//   «два десятка», затем необязательная единица («кг», «литр», «пачки», «батон»…);
// - название из одного слова ставится в именительный падеж: без количества — винительный
//   («сметану» → «сметана»), после количества — родительный («кг гречки» → «гречка»);
//   исключения — в словаре («фасоли» → «фасоль», «яиц» → «яйца»). Если правило не уверено,
//   слово остаётся как сказано. В названии из нескольких слов словарь правит только первое.
import { plural } from '../ui/format.ts';

export type ShoppingDraft = {
  title: string;
  quantity?: string;
  titleConfident?: boolean;
  quantityConfident?: boolean;
};

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

/** Исключения и неоднозначные формы: «два десятка яиц» → «Яйца», «банка фасоли» → «Фасоль». */
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
  фасоли: 'фасоль',
  фасолей: 'фасоль',
  дыни: 'дыня',
  груш: 'груши',
  конфет: 'конфеты',
  слив: 'сливы',
  вишни: 'вишня',
  клубники: 'клубника',
  зелени: 'зелень',
  капусты: 'капуста',
  свёклы: 'свёкла',
  свеклы: 'свекла',
  печенья: 'печенье',
  мороженого: 'мороженое',
  сахару: 'сахар',
  чаю: 'чай',
  сыру: 'сыр',
  мёду: 'мёд',
  меду: 'мед',
  чесноку: 'чеснок',
  луку: 'лук',
  супу: 'суп',
  // Не винительный падеж, хотя кончаются на «-у» и «-ю»: правило их не трогает.
  рагу: 'рагу',
  кешью: 'кешью',
  тофу: 'тофу',
  кускус: 'кускус',
  какао: 'какао',
  макароны: 'макароны',
};

/** Винительный падеж без количества: «сметану» → «сметана», «дыню» → «дыня». */
const ACCUSATIVE: readonly [RegExp, string][] = [
  [/ую$/u, 'ая'],
  [/юю$/u, 'яя'],
  [/([^ью])у$/u, '$1а'],
  [/([^ьаеёиоуыэюя])ю$/u, '$1я'],
];

/** Родительный множественного после числа: «пять огурцов» → «огурцы», «6 сырков» → «сырки». */
const GENITIVE_PLURAL: readonly [RegExp, string][] = [
  [/(?<=\p{L}{2})([кгхжшчщ])ов$/u, '$1и'],
  [/(?<=\p{L}{2})([^аеёиоуыэюяйькгхжшчщ])ов$/u, '$1ы'],
];

/**
 * Родительный единственного после единицы: «кг гречки» → «гречка», «банка сметаны» → «сметана».
 * Формы на «-а», «-я» и «-и» после мягких согласных неоднозначны («сыра» и «молока», «соли»
 * и «дыни») — их правит только словарь.
 */
const GENITIVE: readonly [RegExp, string][] = [
  [/([кгхжшчщ])и$/u, '$1а'],
  [/([^аеёиоуыэюяйь])ы$/u, '$1а'],
  ...GENITIVE_PLURAL,
];

/**
 * Как сказано название: `accusative` — без количества («купить сметану»), `pieces` — после
 * числа без единицы («три сосиски»: это и есть именительный множественного), `unit` — после
 * единицы («пачка гречки»).
 */
export type Context = 'accusative' | 'pieces' | 'unit';
const RULES: Record<Context, readonly [RegExp, string][]> = {
  accusative: ACCUSATIVE,
  pieces: GENITIVE_PLURAL,
  unit: GENITIVE,
};

/** Именительный падеж одного слова по словарю и правилам; без уверенности — как сказано. */
export function nominative(word: string, context: Context): string {
  const lower = word.toLocaleLowerCase('ru');
  const known = NOMINATIVE[lower];
  if (known) return known;
  // Короткие слова («суп», «лук», «чай») правилам не доверяем.
  if (lower.length < 4) return word;
  for (const [pattern, ending] of RULES[context])
    if (pattern.test(lower)) return lower.replace(pattern, ending);
  return word;
}

/** Слова-просьбы в начале фразы: «купить молоко и хлеб». */
const LEAD = /^\s*(?:(?:нужно|надо|ещё|еще)\s+)?(?:купить|купи|взять|возьми)(?:\s*:)?\s+/iu;

/**
 * Разделители позиций. Запятая и точка между цифрами — дробь. Слова-разделители стоят
 * отдельно: перед ними пробел, после — пробел или конец строки.
 */
const SEPARATOR =
  /(?<!\d)[,.]|[,.](?!\d)|[;!?\n]|\s(?:и|ещё|еще|а\s+также|потом|плюс)(?=[\s,.;!?]|$)/iu;

/** Слово-разделитель на краю позиции, прилипшее к знаку препинания: «,и молоко». */
const EDGE_WORD =
  /^(?:и|ещё|еще|а\s+также|потом|плюс)(?:\s+|$)|\s+(?:и|ещё|еще|а\s+также|потом|плюс)$/iu;

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
  const trailing = /^(.+?)\s+(\d+(?:[.,]\d+)?)(?:\s+(\p{L}+\.?))?$/u.exec(part);
  if (
    trailing &&
    !/^\d/u.test(part) &&
    (!trailing[3] || UNITS[trailing[3].toLocaleLowerCase('ru')])
  ) {
    return parseItem(`${trailing[2]} ${trailing[3] ?? ''} ${trailing[1]}`.replace(/\s+/gu, ' '));
  }
  const words = part.replace(EDGE_WORD, '').split(' ').filter(Boolean);
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
  if (value === null || value <= 0) {
    // Без количества: «купить сметану» → «Сметана».
    const only = words.length === 1 ? nominative(words[0] ?? '', 'accusative') : original;
    return { title: capitalize(only).slice(0, TITLE_LIMIT) };
  }
  const rest = words.slice(index);
  if (rest.length === 0) {
    // «три батона»: единица и есть позиция. «2 кг» или просто «батон» оставляем как сказано.
    if (counted && unit?.noun) return { title: unit.noun, quantity: `${formatNumber(value)} шт.` };
    return { title: capitalize(original).slice(0, TITLE_LIMIT) };
  }
  const first = lower[index] ?? '';
  const title =
    rest.length === 1
      ? nominative(rest[0] ?? '', !unit || unit === PIECE ? 'pieces' : 'unit')
      : [NOMINATIVE[first] ?? rest[0], ...rest.slice(1)].join(' ');
  return {
    title: capitalize(title).slice(0, TITLE_LIMIT),
    quantity: unitText(unit ?? PIECE, value),
  };
}

/** Делит надиктованный текст на позиции. Пустые части и лишние разделители пропускаются. */
export function splitShoppingDictation(text: string): ShoppingDraft[] {
  const clean = text
    .replace(/\r\n?|\n/gu, ';')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(LEAD, '');
  if (!clean) return [];
  return ` ${clean} `
    .split(SEPARATOR)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .map(parseItem)
    .filter((item): item is ShoppingDraft => item !== null);
}

export const NO_ITEMS_MESSAGE = 'Не удалось разобрать позиции, попробуйте ещё раз';

/** Итог диктовки: черновики или сообщение, если позиций нет («и», «, ,», тишина). */
export function dictatedDrafts(text: string): { drafts: ShoppingDraft[] } | { error: string } {
  const drafts = splitShoppingDictation(text);
  return drafts.length ? { drafts } : { error: NO_ITEMS_MESSAGE };
}
