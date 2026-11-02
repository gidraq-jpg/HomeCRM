import { useState } from 'react';

const key = 'homecrm.motion-slow';
export function loadSlowMotion() {
  for (const name of ['Sections', 'Tabs', 'Forms']) {
    try {
      const value = localStorage.getItem(`homecrm.motion-${name}`);
      if (value) document.documentElement.dataset[`motion${name}`] = value;
    } catch {
      /* Выбор действует до перезагрузки. */
    }
  }
  try {
    document.documentElement.toggleAttribute('data-motion-slow', localStorage.getItem(key) === '4');
  } catch {
    /* В закрытом хранилище настройка действует до перезагрузки. */
  }
}
export function SlowMotionControl() {
  const [slow, setSlow] = useState(() => {
    if (typeof document === 'undefined') return false;
    try {
      return localStorage.getItem(key) === '4';
    } catch {
      return document.documentElement.hasAttribute('data-motion-slow');
    }
  });
  return (
    <details className="motion-check">
      <summary>Для проверки</summary>
      <label className="check-field">
        <input
          type="checkbox"
          checked={slow}
          onChange={(event) => {
            const enabled = event.target.checked;
            setSlow(enabled);
            document.documentElement.toggleAttribute('data-motion-slow', enabled);
            try {
              localStorage.setItem(key, enabled ? '4' : '1');
            } catch {
              /* Текущий выбор уже применён к интерфейсу. */
            }
          }}
        />{' '}
        Анимации медленнее ×4
      </label>
      <MotionChoice
        name="Sections"
        label="Разделы с главного"
        values={['side', 'sheet']}
        labels={['Сбоку', 'Снизу']}
      />
      <MotionChoice
        name="Tabs"
        label="Нижние вкладки"
        values={['instant', 'fade']}
        labels={['Мгновенно', 'Затухание 150 мс']}
      />
      <MotionChoice
        name="Forms"
        label="Длинные формы"
        values={['sheet', 'side']}
        labels={['Снизу во весь экран', 'Сбоку']}
      />
    </details>
  );
}

function MotionChoice({
  name,
  label,
  values,
  labels,
}: {
  name: string;
  label: string;
  values: string[];
  labels: string[];
}) {
  const [value, setValue] = useState(
    () => document.documentElement.dataset[`motion${name}`] ?? values[0],
  );
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          document.documentElement.dataset[`motion${name}`] = next;
          try {
            localStorage.setItem(`homecrm.motion-${name}`, next);
          } catch {
            /* Выбор уже применён. */
          }
        }}
      >
        {values.map((item, index) => (
          <option key={item} value={item}>
            {labels[index]}
          </option>
        ))}
      </select>
    </label>
  );
}
