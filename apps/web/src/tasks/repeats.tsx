import type { OverduePolicy, RepeatRule } from './api.ts';
import { SelectField, TextField } from './fields.tsx';
export const REPEAT_OPTIONS = [
  { value: '', label: 'Без повтора' },
  { value: 'daily', label: 'Ежедневно' },
  { value: 'weekly', label: 'Дни недели' },
  { value: 'monthly', label: 'Ежемесячно' },
  { value: 'yearly', label: 'Ежегодно' },
  { value: 'every_days', label: 'Каждые N дней' },
  { value: 'after_done', label: 'После выполнения' },
];
export const POLICY_OPTIONS = [
  { value: 'keep', label: 'Оставить просроченным' },
  { value: 'roll_forward', label: 'Перенести на сегодня' },
  { value: 'not_done', label: 'Не сделано и следующий' },
];
export const POLICY_HINTS: Record<OverduePolicy, string> = {
  keep: 'Дело остаётся открытым на прежнюю дату.',
  roll_forward:
    'После полуночи сервер перенесёт дело на сегодняшний день, сохранив расстояние до крайнего срока.',
  not_done:
    'Сервер отметит пропущенное дело «Не сделано» и создаст ближайшее следующее без пачки пропусков.',
};
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function repeatLabel(rule: RepeatRule | null): string {
  if (!rule) return '';
  switch (rule.kind) {
    case 'daily':
      return 'Ежедневно';
    case 'weekly':
      return `По дням: ${rule.weekdays.map((day) => weekdays[day - 1]).join(', ')}`;
    case 'monthly':
      return rule.day === 'last' ? 'Последний день месяца' : `Каждый месяц, ${rule.day}-го`;
    case 'yearly':
      return `Каждый год, ${rule.day}.${rule.month}`;
    case 'every_days':
      return `Каждые ${rule.days} дн.`;
    case 'after_done':
      return `Через ${rule.days} дн. после выполнения`;
  }
}
export function newRepeat(kind: string): RepeatRule | null {
  switch (kind) {
    case 'daily':
      return { kind };
    case 'weekly':
      return { kind, weekdays: [1] };
    case 'monthly':
      return { kind, day: 1 };
    case 'yearly':
      return { kind, month: 1, day: 1 };
    case 'every_days':
    case 'after_done':
      return { kind, days: 1 };
    default:
      return null;
  }
}
export function RepeatFields({
  rule,
  policy,
  onRule,
  onPolicy,
  disabled = false,
}: {
  rule: RepeatRule | null;
  policy: OverduePolicy;
  onRule: (rule: RepeatRule | null) => void;
  onPolicy: (policy: OverduePolicy) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="task-repeat">
      <legend>Повтор</legend>
      <SelectField
        label="Расписание"
        value={rule?.kind ?? ''}
        onChange={(value) => onRule(newRepeat(value))}
        options={REPEAT_OPTIONS}
        disabled={disabled}
      />
      {rule?.kind === 'weekly' ? (
        <fieldset>
          <legend>Дни недели</legend>
          <div className="task-chips">
            {weekdays.map((day, index) => (
              <label key={day} className="task-weekday">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={rule.weekdays.includes(index + 1)}
                  onChange={(event) =>
                    onRule({
                      ...rule,
                      weekdays: event.target.checked
                        ? [...rule.weekdays, index + 1].sort()
                        : rule.weekdays.filter((value) => value !== index + 1),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {rule?.kind === 'monthly' ? (
        <>
          <SelectField
            label="День месяца"
            value={rule.day === 'last' ? 'last' : 'number'}
            onChange={(value) => onRule({ ...rule, day: value === 'last' ? 'last' : 1 })}
            options={[
              { value: 'number', label: 'Число' },
              { value: 'last', label: 'Последний день' },
            ]}
            disabled={disabled}
          />
          {rule.day !== 'last' ? (
            <TextField
              label="Число месяца (1–31)"
              type="number"
              value={String(rule.day)}
              onChange={(value) => onRule({ ...rule, day: Number(value) })}
              disabled={disabled}
            />
          ) : null}
        </>
      ) : null}
      {rule?.kind === 'yearly' ? (
        <div className="task-fields">
          <TextField
            label="Месяц (1–12)"
            type="number"
            value={String(rule.month)}
            onChange={(value) => onRule({ ...rule, month: Number(value) })}
            disabled={disabled}
          />
          <TextField
            label="День (1–31)"
            type="number"
            value={String(rule.day)}
            onChange={(value) => onRule({ ...rule, day: Number(value) })}
            disabled={disabled}
          />
        </div>
      ) : null}
      {rule?.kind === 'every_days' || rule?.kind === 'after_done' ? (
        <TextField
          label="Число дней (1–3650)"
          type="number"
          value={String(rule.days)}
          onChange={(value) => onRule({ ...rule, days: Number(value) })}
          disabled={disabled}
        />
      ) : null}
      {rule ? (
        <>
          <p className="muted">
            Начальная дата обязательна. 31-е и 29 февраля переносятся на последний день короткого
            месяца. Следующее дело создаёт сервер: чек-лист сбрасывается; файлы, связи и ожидание не
            копируются.
          </p>
          <SelectField
            label="Если пропущено"
            value={policy}
            onChange={(value) => onPolicy(value as OverduePolicy)}
            options={POLICY_OPTIONS}
            disabled={disabled}
          />
          <p className="muted">{POLICY_HINTS[policy]}</p>
        </>
      ) : null}
    </fieldset>
  );
}
