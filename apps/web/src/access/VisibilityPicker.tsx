import { useId } from 'react';
import { VISIBILITY_ICONS } from './AccessBadge.tsx';
import {
  VISIBILITIES,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  type Visibility,
} from './visibility.ts';

interface VisibilityPickerProps {
  value: Visibility;
  onChange: (value: Visibility) => void;
  /** Какие значения предложить: при «Поделиться…» личное не предлагается. */
  options?: readonly Visibility[];
  legend?: string;
  /** Особое пояснение, когда действие сохраняет доступ существующей записи. */
  hint?: string;
}

/**
 * Строка «Кто видит» — стоит над кнопкой «Сохранить» в каждой форме создания (PRD, 7.4).
 * Три обычных переключателя: значок, подпись и пояснение к выбранному значению.
 */
export function VisibilityPicker({
  value,
  onChange,
  options = VISIBILITIES,
  legend = 'Кто видит',
  hint,
}: VisibilityPickerProps) {
  const name = useId();
  return (
    <fieldset className="visibility">
      <legend className="visibility__legend">{legend}</legend>
      <div className="visibility__options">
        {options.map((option) => {
          const Icon = VISIBILITY_ICONS[option];
          return (
            <label className="visibility__option" key={option}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              <span className="visibility__label">
                <Icon size={22} aria-hidden />
                {VISIBILITY_LABELS[option]}
              </span>
            </label>
          );
        })}
      </div>
      <p className="visibility__hint">{hint ?? VISIBILITY_HINTS[value]}</p>
    </fieldset>
  );
}
