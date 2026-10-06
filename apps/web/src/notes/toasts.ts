import { matchesScope, SCOPE_LABELS, type Scope } from '../access/scope.ts';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import type { ToastOptions } from '../ui/Toast.tsx';

/**
 * Сообщение после смены места или доступа заметки. Если выбранный в шапке режим её уже не
 * показывает, сообщение говорит об этом и предлагает вернуть «Всё»: запись не «пропала».
 */
export function accessToast(
  message: string,
  visibility: Visibility,
  scope: Scope,
  showAll: () => void,
): ToastOptions {
  const hidden = !matchesScope(visibility, scope);
  return {
    message,
    detail: hidden
      ? `Кто видит: ${VISIBILITY_LABELS[visibility]}. Режим «${SCOPE_LABELS[scope]}» её не показывает.`
      : `Кто видит: ${VISIBILITY_LABELS[visibility]}`,
    ...(hidden ? { action: { label: 'Показать всё', onClick: showAll } } : {}),
    durationMs: hidden ? 10_000 : 7000,
  };
}
