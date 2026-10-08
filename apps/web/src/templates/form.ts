import type { Visibility } from '../access/visibility.ts';
import type { Me } from '../auth/api.ts';
import { checkZone, type Digits, problemText } from '../meters/decimal.ts';
import type { ApplyRequest, TaxRegime, Template } from './api.ts';

// Форма применения шаблона (TPL-2, TPL-3): чистые функции без React. Шаблон предлагает пункты
// с галочками; снятая галочка — пункт не создаётся; пустой набор — просто объект.

export const MAX_TITLE = 200;
export const MAX_ADDRESS = 4000;

/** Разрядность счётчика из шаблона по умолчанию: пять цифр до запятой, три после. */
export const TEMPLATE_DIGITS: Digits = { integerDigits: 5, fractionDigits: 3 };

/** Единицы шаблонных счётчиков: ХВС, ГВС и газ — в кубометрах. */
export const METER_UNITS: Readonly<Record<string, string>> = {
  cold_water: 'м³',
  hot_water: 'м³',
  gas: 'м³',
  electricity: 'кВт·ч',
  heat: 'Гкал',
};

export interface Selection {
  accounts: ReadonlySet<string>;
  meters: ReadonlySet<string>;
  organizations: ReadonlySet<string>;
  deadlines: ReadonlySet<string>;
  /** Налоговый режим «Сдаваемой квартиры»; пусто — не выбирать. */
  taxRegime: TaxRegime | '';
}

export type SelectionGroup = 'accounts' | 'meters' | 'organizations' | 'deadlines';

/** Все пункты, которые шаблон отметил по умолчанию. Налоговый режим выбирается явно. */
export function initialSelection(template: Template): Selection {
  const picked = (items: readonly { id: string; selected: boolean }[]) =>
    new Set(items.filter((item) => item.selected).map((item) => item.id));
  return {
    accounts: picked(template.accounts),
    meters: picked(template.meters),
    organizations: picked(template.organizations),
    deadlines: picked(template.deadlines),
    taxRegime: '',
  };
}

export function toggled(selection: Selection, group: SelectionGroup, id: string): Selection {
  const next = new Set(selection[group]);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...selection, [group]: next };
}

/** Сколько пунктов выбрано всего (налоговый режим считается одним пунктом). */
export function selectedCount(selection: Selection): number {
  return (
    selection.accounts.size +
    selection.meters.size +
    selection.organizations.size +
    selection.deadlines.size +
    (selection.taxRegime === '' ? 0 : 1)
  );
}

export interface FormValues {
  title: string;
  address: string;
  /** Начальное показание по счётчику: строка из поля ввода. */
  readings: Readonly<Record<string, string>>;
  /** Дата всех начальных показаний. */
  readingDate: string;
}

export interface FormErrors {
  title?: string;
  address?: string;
  readingDate?: string;
  /** Ошибки показаний по идентификатору счётчика. */
  readings: Record<string, string>;
}

export interface Where {
  me: Pick<Me, 'personalSpaceId'>;
  householdId: string | null;
  visibility: Visibility;
}

export type BuildResult =
  | { ok: true; request: Omit<ApplyRequest, 'idempotencyKey'> }
  | { ok: false; errors: FormErrors };

/** Место объекта: личное — в личном пространстве, общее — в доме с выбранной аудиторией. */
export function placementOf(where: Where): Pick<ApplyRequest, 'placement' | 'householdId'> | null {
  if (where.visibility === 'personal') {
    if (where.me.personalSpaceId === null) return null;
    return {
      placement: { spaceId: where.me.personalSpaceId },
      // Сроки личного объекта считаются по календарю дома.
      ...(where.householdId === null ? {} : { householdId: where.householdId }),
    };
  }
  if (where.householdId === null) return null;
  return { placement: { spaceId: where.householdId, audience: where.visibility } };
}

/**
 * Запрос на применение шаблона из формы. Начальное показание по счётчику необязательно; если оно
 * введено, то должно быть числом с запятой или точкой в пределах разрядности счётчика.
 */
export function buildRequest(
  template: Template,
  selection: Selection,
  values: FormValues,
  where: Where,
  today: string,
): BuildResult {
  const errors: FormErrors = { readings: {} };
  const title = values.title.trim();
  if (title === '') errors.title = 'Назовите объект, например «Квартира на Садовой».';
  else if (title.length > MAX_TITLE) errors.title = `Название не длиннее ${MAX_TITLE} знаков.`;
  const address = values.address.trim();
  if (address.length > MAX_ADDRESS) errors.address = `Адрес не длиннее ${MAX_ADDRESS} знаков.`;

  const meters: ApplyRequest['meters'] = [];
  const anyReading = template.meters.some(
    (meter) => selection.meters.has(meter.id) && (values.readings[meter.id] ?? '').trim() !== '',
  );
  if (
    anyReading &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(values.readingDate) || values.readingDate > today)
  ) {
    errors.readingDate = 'Укажите дату показаний не позже сегодняшней.';
  }
  for (const meter of template.meters) {
    if (!selection.meters.has(meter.id)) continue;
    const input = values.readings[meter.id] ?? '';
    const checked = checkZone(TEMPLATE_DIGITS, input, null, false);
    if (checked.status === 'empty') meters.push({ id: meter.id });
    else if (checked.status === 'invalid') {
      errors.readings[meter.id] = problemText(checked.problem, TEMPLATE_DIGITS);
    } else {
      meters.push({
        id: meter.id,
        initialReading: { occurredOn: values.readingDate, values: [checked.value] },
      });
    }
  }

  const place = placementOf(where);
  if (
    errors.title !== undefined ||
    errors.address !== undefined ||
    errors.readingDate !== undefined ||
    Object.keys(errors.readings).length > 0 ||
    place === null
  ) {
    return { ok: false, errors };
  }
  const ids = (items: readonly { id: string }[], chosen: ReadonlySet<string>) =>
    items.filter((item) => chosen.has(item.id)).map((item) => ({ id: item.id }));
  return {
    ok: true,
    request: {
      title,
      ...(address === '' ? {} : { propertyData: { address } }),
      ...place,
      accounts: ids(template.accounts, selection.accounts),
      meters,
      organizations: template.organizations
        .filter((item) => selection.organizations.has(item.id))
        .map((item) => item.id),
      deadlines: ids(template.deadlines, selection.deadlines),
      ...(selection.taxRegime === '' ? {} : { taxRegime: selection.taxRegime }),
    },
  };
}

/** Новый ключ идемпотентности: UUID версии 4. */
export function newKey(): string {
  return crypto.randomUUID();
}
