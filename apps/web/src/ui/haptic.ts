/** Короткий отклик необязателен: браузер может вернуть false, действие от этого не зависит. */
export function haptic() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
    navigator.vibrate(10);
}
