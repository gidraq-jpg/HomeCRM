import { useId } from 'react';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipGroupProps<T extends string> {
  /** Название группы для читалок экрана; на экране его нет. */
  legend: string;
  value: T;
  options: readonly ChipOption<T>[];
  onChange: (value: T) => void;
}

/** Фильтр «один из»: обычные переключатели в виде плашек, стрелки работают, как у любой группы. */
export function ChipGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: ChipGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="chip-group">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <label className="chip" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="chip__label">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
