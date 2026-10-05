import { filterByScope, type Scope } from '../access/scope.ts';
import type { Visibility } from '../access/visibility.ts';
import { type DateOnly, formatShortDate, normalizeText } from '../ui/format.ts';
import { ACCOUNTS, METERS } from './data/index.ts';
import type { PropertyStatus, ProtoRecord } from './model.ts';

// Единый поиск по записям, которые видит участник (PRD, SRCH-1…3): названия, номера,
// телефоны, тексты заметок. Понимает словоформы («страховка», «страховку») и части номера.
// Результаты сгруппированы по типам, у каждого — значок доступа, номер копируется на месте.

export type SearchGroup = 'home' | 'documents' | 'people' | 'tasks' | 'notes' | 'shopping';

export const SEARCH_GROUPS: readonly { group: SearchGroup; label: string }[] = [
  { group: 'home', label: 'Дом' },
  { group: 'documents', label: 'Документы' },
  { group: 'people', label: 'Люди и организации' },
  { group: 'tasks', label: 'Дела' },
  { group: 'notes', label: 'Заметки' },
  { group: 'shopping', label: 'Покупки' },
];

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string;
  to: string;
  visibility: Visibility;
  /** Что копируется прямо из результата: номер счёта, документа, телефон. */
  copy?: { what: string; value: string };
  tokens: string[];
  digits: string;
}

export interface SearchGroupResult {
  group: SearchGroup;
  label: string;
  entries: SearchEntry[];
}

const WORD_SEPARATORS = /[^\p{L}\p{N}]+/u;

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(WORD_SEPARATORS)
    .filter((token) => token.length > 0);
}

/**
 * Грубая основа слова: отбрасывает окончание, чтобы «страховка», «страховку» и «страхование»
 * находились по общему началу. Настоящий разбор словоформ — задача сервера (SRCH-2).
 */
export function stem(word: string): string {
  if (word.length > 5) return word.slice(0, word.length - 2);
  if (word.length > 3) return word.slice(0, word.length - 1);
  return word;
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

function makeEntry(
  entry: Omit<SearchEntry, 'tokens' | 'digits'>,
  texts: readonly (string | undefined)[],
): SearchEntry {
  const joined = texts.filter((text): text is string => text !== undefined).join(' ');
  return { ...entry, tokens: tokenize(joined), digits: digitsOf(joined) };
}

/** Все слова запроса должны найтись; цифры сравниваются без пробелов и знаков. */
export function matches(entry: SearchEntry, query: string): boolean {
  const words = tokenize(query);
  if (words.length === 0) return false;
  return words.every((word) => {
    if (/\d/.test(word)) return entry.digits.includes(digitsOf(word));
    const root = stem(word);
    return entry.tokens.some((token) => token.startsWith(root));
  });
}

const STATUS_LABELS: Readonly<Record<PropertyStatus, string>> = {
  live: 'живём',
  rent: 'сдаётся',
  empty: 'пустует',
};

export function buildSearchEntries(
  records: readonly ProtoRecord[],
  today: DateOnly,
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const properties = new Map(
    records.flatMap((record) => (record.kind === 'property' ? [[record.id, record] as const] : [])),
  );

  for (const record of records) {
    switch (record.kind) {
      case 'property':
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'home',
              title: record.title,
              subtitle: `${record.address} · ${STATUS_LABELS[record.status]}`,
              to: `/home/${record.id}`,
              visibility: record.visibility,
            },
            [record.title, record.address, record.propertyType, STATUS_LABELS[record.status]],
          ),
        );
        break;
      case 'document':
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'documents',
              title: record.title,
              subtitle:
                record.expires === null
                  ? `${record.owner} · бессрочно`
                  : `${record.owner} · до ${formatShortDate(record.expires, today)}`,
              to: `/documents/${record.id}`,
              visibility: record.visibility,
              ...(record.number ? { copy: { what: 'номер документа', value: record.number } } : {}),
            },
            [record.title, record.docType, record.owner, record.number, record.issuedBy],
          ),
        );
        break;
      case 'contact': {
        const phone = record.phones[0];
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'people',
              title: record.name,
              subtitle: phone ? `${record.role} · ${phone.number}` : record.role,
              to: `/people/${record.id}`,
              visibility: record.visibility,
              ...(phone ? { copy: { what: 'телефон', value: phone.number } } : {}),
            },
            [
              record.name,
              record.role,
              record.note,
              record.address,
              ...record.phones.map((item) => item.number),
            ],
          ),
        );
        break;
      }
      case 'task':
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'tasks',
              title: record.title,
              subtitle: record.when === null ? 'Без даты' : formatShortDate(record.when, today),
              to: '/today/all',
              visibility: record.visibility,
            },
            [record.title, record.waiting],
          ),
        );
        break;
      case 'note':
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'notes',
              title: record.title,
              subtitle: record.text,
              to: `/more/notes/${record.id}`,
              visibility: record.visibility,
            },
            [record.title, record.text],
          ),
        );
        break;
      case 'shopping':
        entries.push(
          makeEntry(
            {
              id: record.id,
              group: 'shopping',
              title: record.title,
              subtitle: record.bought ? 'Куплено' : 'Нужно купить',
              to: '/more/shopping',
              visibility: record.visibility,
            },
            [record.title],
          ),
        );
        break;
    }
  }

  // Лицевые счета и счётчики лежат в пространстве объекта и видны так же, как он.
  for (const account of ACCOUNTS) {
    const property = properties.get(account.propertyId);
    if (property === undefined) continue;
    entries.push(
      makeEntry(
        {
          id: account.id,
          group: 'home',
          title: `${account.title}, лицевой счёт`,
          subtitle: `${property.title} · № ${account.number}`,
          to: `/home/${property.id}/utilities`,
          visibility: property.visibility,
          copy: { what: 'номер лицевого счёта', value: account.number },
        },
        [
          account.title,
          account.short,
          account.supplier,
          account.number,
          account.method,
          property.title,
          property.address,
          'лицевой счёт',
        ],
      ),
    );
  }
  for (const meter of METERS) {
    const property = properties.get(meter.propertyId);
    if (property === undefined) continue;
    entries.push(
      makeEntry(
        {
          id: meter.id,
          group: 'home',
          title: `Счётчик ${meter.resource}, ${meter.place.toLowerCase()}`,
          subtitle: `${property.title} · заводской № ${meter.serial}`,
          to: `/home/${property.id}/meters`,
          visibility: property.visibility,
          copy: { what: 'заводской номер', value: meter.serial },
        },
        [meter.resource, meter.place, meter.serial, property.title, property.address, 'счётчик'],
      ),
    );
  }
  return entries;
}

/** Результаты по запросу в выбранном режиме, сгруппированные по типам. */
export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  scope: Scope,
): SearchGroupResult[] {
  if (tokenize(query).length === 0) return [];
  const found = filterByScope(entries, scope).filter((entry) => matches(entry, query));
  return SEARCH_GROUPS.flatMap(({ group, label }) => {
    const inGroup = found.filter((entry) => entry.group === group);
    return inGroup.length > 0 ? [{ group, label, entries: inGroup }] : [];
  });
}

export function countResults(groups: readonly SearchGroupResult[]): number {
  return groups.reduce((sum, group) => sum + group.entries.length, 0);
}
