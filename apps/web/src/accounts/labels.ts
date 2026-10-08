import { UTILITY_SERVICES, type UtilityAccountData } from '@homecrm/shared';

// Тексты лицевого счёта (UTIL-2, приложение А PRD): услуги, способ передачи, кто платит, окно и срок.

export type UtilityService = (typeof UTILITY_SERVICES)[number];
export type Transmission = NonNullable<UtilityAccountData['transmission']>;
export type TransmissionMethod = Transmission['method'];
export type Payer = UtilityAccountData['payer'];
export type MonthlyRule = NonNullable<UtilityAccountData['readingRule']>;

/** Услуги — закрытый список из приложения А, в том же порядке. */
export const SERVICE_LABELS: Readonly<Record<UtilityService, string>> = {
  maintenance: 'Содержание и ремонт',
  unified_bill: 'Единый платёжный документ (ЕПД)',
  electricity: 'Электроэнергия',
  water_sewerage: 'Водоснабжение и водоотведение',
  heating: 'Отопление',
  gas: 'Газ',
  waste: 'Обращение с ТКО',
  capital_repairs: 'Взносы на капремонт',
  internet_tv: 'Интернет и ТВ',
  intercom: 'Домофон',
  other: 'Другое',
};

export const SERVICES: readonly UtilityService[] = UTILITY_SERVICES;

export const TRANSMISSION_LABELS: Readonly<Record<TransmissionMethod, string>> = {
  gosuslugi_dom: 'Госуслуги Дом',
  provider: 'Сайт или приложение поставщика',
  phone: 'По телефону',
  automatic: 'Автоматически',
  not_required: 'Не требуется',
};

export const TRANSMISSION_METHODS = Object.keys(TRANSMISSION_LABELS) as TransmissionMethod[];

export const PAYER_LABELS: Readonly<Record<Payer, string>> = {
  owner: 'Собственник',
  tenant: 'Арендатор',
  other: 'Другое',
};

export const PAYERS = Object.keys(PAYER_LABELS) as Payer[];

export function servicesText(services: readonly UtilityService[]): string {
  return services.length === 0 ? 'не выбраны' : services.map((s) => SERVICE_LABELS[s]).join(', ');
}

/** Окно передачи показаний ежемесячного правила: числа начала и конца (конец может быть пустым). */
export function windowOf(rule: MonthlyRule | null): { from: number; to: number | null } | null {
  if (rule === null || rule.kind !== 'repeat' || rule.repeat.unit !== 'month') return null;
  const { day, endDay } = rule.repeat;
  if (endDay !== undefined) return { from: day, to: endDay };
  if (rule.durationDays > 0 && day + rule.durationDays <= 31) {
    return { from: day, to: day + rule.durationDays };
  }
  return { from: day, to: null };
}

/** «с 20 по 25 число» — окно «с 20 по 25»; если конец раньше начала, окно идёт на следующий месяц. */
export function describeWindow(rule: MonthlyRule | null): string {
  const span = windowOf(rule);
  if (span === null) return 'не задано';
  if (span.to === null || span.to === span.from) return `${span.from}-го числа`;
  return span.to < span.from
    ? `с ${span.from} по ${span.to} числа следующего месяца`
    : `с ${span.from} по ${span.to} числа`;
}

/** Срок оплаты — число месяца. */
export function payDayOf(rule: MonthlyRule | null): number | null {
  if (rule === null || rule.kind !== 'repeat' || rule.repeat.unit !== 'month') return null;
  return rule.repeat.day;
}

export function describePayDay(rule: MonthlyRule | null): string {
  const day = payDayOf(rule);
  return day === null ? 'не задан' : `${day}-го числа каждого месяца`;
}

export function describeTransmission(transmission: Transmission | null): string {
  if (transmission === null) return 'не указан';
  switch (transmission.method) {
    case 'provider':
      return TRANSMISSION_LABELS.provider;
    case 'phone':
      return `${TRANSMISSION_LABELS.phone}: ${transmission.phone}`;
    default:
      return TRANSMISSION_LABELS[transmission.method];
  }
}
