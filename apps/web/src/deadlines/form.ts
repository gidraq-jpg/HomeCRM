import { DeadlineRule } from '@homecrm/shared';
import { addDays, type DateOnly, daysBetween, parseDateOnly } from '../ui/format.ts';
import { asDateOnly } from './labels.ts';

// Черновик формы срока (DEAD-1): поля формы — строки, как их вводит человек. Из черновика
// собирается правило, проверенное той же схемой, что и на сервере.

export const RULE_KINDS = ['date', 'window', 'repeat', 'after'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const REPEAT_UNITS = ['day', 'month', 'year'] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export const AFTER_UNITS = ['day', 'month'] as const;
export type AfterUnit = (typeof AFTER_UNITS)[number];

export interface Draft {
  kind: RuleKind;
  /** Дата срока, начало окна, «начиная с» повтора или дата события. */
  date: string;
  /** Время начала `HH:mm`; пусто — без времени. */
  time: string;
  /** Конец окна. */
  endDate: string;
  endTime: string;
  repeatUnit: RepeatUnit;
  /** «Каждые N»: у повтора и у «через N после события». */
  every: string;
  /** День месяца для повтора по месяцам и годам. */
  monthDay: string;
  /** Месяц 1–12 для ежегодного повтора. */
  month: string;
  /** Сколько дней длится повторяющееся окно после первого. */
  durationDays: string;
  afterUnit: AfterUnit;
  warnings: number[];
}

export type DraftField =
  | 'date'
  | 'time'
  | 'endDate'
  | 'endTime'
  | 'every'
  | 'monthDay'
  | 'month'
  | 'durationDays';

export type DraftResult =
  | { ok: true; rule: DeadlineRule }
  | { ok: false; field: DraftField; message: string };

/** Новый срок: сегодняшняя дата, повтор — раз в месяц в тот же день, предупреждение за неделю. */
export function emptyDraft(today: DateOnly): Draft {
  return {
    kind: 'date',
    date: today,
    time: '',
    endDate: today,
    endTime: '',
    repeatUnit: 'month',
    every: '1',
    monthDay: String(parseDateOnly(today).day),
    month: String(parseDateOnly(today).month),
    durationDays: '0',
    afterUnit: 'day',
    warnings: [7],
  };
}

function clock(time: string): string {
  return time === '' ? '00:00' : time;
}

function whole(value: string): number | null {
  return /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : null;
}

const NO_DATE = 'Укажите дату.';

/** Правило из черновика; если что-то введено неверно — какое поле исправить и что сказать. */
export function ruleFromDraft(draft: Draft): DraftResult {
  const warnings = [...new Set(draft.warnings)].sort((a, b) => b - a);
  const bad = (field: DraftField, message: string): DraftResult => ({ ok: false, field, message });
  let candidate: unknown;
  switch (draft.kind) {
    case 'date':
      if (draft.date === '') return bad('date', NO_DATE);
      candidate = { kind: 'date', date: draft.date, time: clock(draft.time), warnings };
      break;
    case 'window': {
      if (draft.date === '') return bad('date', 'Укажите, когда окно начинается.');
      if (draft.endDate === '') return bad('endDate', 'Укажите, когда окно заканчивается.');
      if (draft.time === '') return bad('time', 'Укажите время начала окна.');
      if (draft.endTime === '') return bad('endTime', 'Укажите время конца окна.');
      const days = daysBetween(asDateOnly(draft.date), asDateOnly(draft.endDate));
      if (days < 0 || (days === 0 && draft.endTime < draft.time))
        return bad('endDate', 'Окно не может закончиться раньше, чем началось.');
      candidate = {
        kind: 'window',
        date: draft.date,
        time: draft.time,
        durationDays: days,
        endTime: draft.endTime,
        warnings,
      };
      break;
    }
    case 'repeat': {
      if (draft.date === '') return bad('date', 'Укажите, с какой даты считать повтор.');
      const every = whole(draft.every);
      if (every === null || every < 1 || every > 1200)
        return bad('every', 'Введите число от 1 до 1200.');
      const duration = whole(draft.durationDays);
      if (duration === null || duration > 366) return bad('durationDays', 'Введите от 0 до 366.');
      const common = {
        kind: 'repeat',
        anchor: draft.date,
        time: clock(draft.time),
        durationDays: duration,
        warnings,
      };
      if (draft.repeatUnit === 'day') {
        candidate = { ...common, repeat: { unit: 'day', every } };
        break;
      }
      const day = whole(draft.monthDay);
      if (day === null || day < 1 || day > 31) return bad('monthDay', 'Введите день от 1 до 31.');
      if (draft.repeatUnit === 'month') {
        candidate = { ...common, repeat: { unit: 'month', every, day } };
        break;
      }
      const month = whole(draft.month);
      if (month === null || month < 1 || month > 12) return bad('month', 'Выберите месяц.');
      candidate = { ...common, repeat: { unit: 'year', every, month, day } };
      break;
    }
    case 'after': {
      const every = whole(draft.every);
      if (every === null || every < 1 || every > 1200)
        return bad('every', 'Введите число от 1 до 1200.');
      candidate = {
        kind: 'after',
        eventDate: draft.date === '' ? null : draft.date,
        every,
        unit: draft.afterUnit,
        time: clock(draft.time),
        warnings,
      };
      break;
    }
  }
  const parsed = DeadlineRule.safeParse(candidate);
  return parsed.success
    ? { ok: true, rule: parsed.data }
    : bad('date', 'Проверьте введённые значения.');
}

/** Черновик из сохранённого правила — для правки. */
export function draftFromRule(rule: DeadlineRule, today: DateOnly): Draft {
  const base = emptyDraft(today);
  const time = rule.time === '00:00' ? '' : rule.time;
  const common = { warnings: [...rule.warnings].sort((a, b) => b - a), time };
  switch (rule.kind) {
    case 'date':
      return { ...base, ...common, kind: 'date', date: rule.date };
    case 'window':
      return {
        ...base,
        ...common,
        kind: 'window',
        // У окна время начала обязательно: «00:00» — настоящее время, его не прячем.
        time: rule.time,
        date: rule.date,
        endDate: addDays(asDateOnly(rule.date), rule.durationDays),
        endTime: rule.endTime,
      };
    case 'repeat': {
      const { repeat } = rule;
      return {
        ...base,
        ...common,
        kind: 'repeat',
        date: rule.anchor,
        repeatUnit: repeat.unit,
        every: String(repeat.every),
        durationDays: String(rule.durationDays),
        ...(repeat.unit === 'day' ? {} : { monthDay: String(repeat.day) }),
        ...(repeat.unit === 'year' ? { month: String(repeat.month) } : {}),
      };
    }
    case 'after':
      return {
        ...base,
        ...common,
        kind: 'after',
        date: rule.eventDate ?? '',
        every: String(rule.every),
        afterUnit: rule.unit,
      };
  }
}
