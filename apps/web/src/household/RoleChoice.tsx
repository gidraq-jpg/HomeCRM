import { ROLE_LABELS, ROLES, type Role } from '@homecrm/shared';
import { useId } from 'react';

/** Что умеет каждая роль — PRD, раздел 6.2. */
export const ROLE_HINTS: Readonly<Record<Role, string>> = {
  admin: 'Управляет домом: приглашает, исключает, меняет роли. Чужое личное не видит.',
  adult: 'Видит общие записи «Вся семья» и «Взрослые», создаёт и меняет общие записи.',
  child: 'Видит только записи «Вся семья». Свой вход и личное пространство.',
};

interface RoleChoiceProps {
  value: Role;
  onChange: (role: Role) => void;
  legend?: string;
}

/** Выбор роли: три обычных переключателя с пояснением у каждой. */
export function RoleChoice({ value, onChange, legend = 'Роль' }: RoleChoiceProps) {
  const name = useId();
  return (
    <fieldset className="choice-group">
      <legend className="choice-group__legend">{legend}</legend>
      {ROLES.map((role) => (
        <label className="choice" key={role}>
          <input
            type="radio"
            name={name}
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
          />
          <span className="choice__body">
            <span className="choice__title">{ROLE_LABELS[role]}</span>
            <span className="choice__hint">{ROLE_HINTS[role]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
