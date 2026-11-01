import { useState } from 'react';

const key = 'homecrm.motion-slow';
export function loadSlowMotion() {
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
    </details>
  );
}
