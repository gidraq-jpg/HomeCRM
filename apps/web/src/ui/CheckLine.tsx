import { Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

interface CheckLineProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

/** Флажок с подписью на всю ширину строки: цель нажатия — вся строка, не меньше 48 px. */
export function CheckLine({ checked, onChange, children }: CheckLineProps) {
  return (
    <label className="check-line">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-line__box">
        {checked ? <Check size={16} weight="bold" aria-hidden /> : null}
      </span>
      <span>{children}</span>
    </label>
  );
}
