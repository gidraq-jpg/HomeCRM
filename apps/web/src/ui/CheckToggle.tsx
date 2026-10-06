import { Check } from '@phosphor-icons/react';

interface CheckToggleProps {
  checked: boolean;
  /** Что отмечаем: название дела или покупки — читалки экрана озвучивают его. */
  label: string;
  onChange: () => void;
  /** Нельзя менять: читатель без права правки видит отметку, но не переключает её. */
  disabled?: boolean;
}

/** Круглая отметка «сделано» из LifeOS: обычный флажок с целью нажатия 44 на 52 px. */
export function CheckToggle({ checked, label, onChange, disabled = false }: CheckToggleProps) {
  return (
    <label className={disabled ? 'check-toggle check-toggle--disabled' : 'check-toggle'}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="check-toggle__circle">
        {checked ? <Check size={16} weight="bold" aria-hidden /> : null}
      </span>
    </label>
  );
}
