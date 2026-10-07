import { useState, useSyncExternalStore } from 'react';
import { Section } from '../ui/Page.tsx';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Браузер присылает beforeinstallprompt один раз и рано. Ловим его при загрузке модуля, чтобы кнопка
// работала там, где она появится позже: на экранах входа и в настройках, а не только при первом показе.
let offered: InstallEvent | null = null;
let installed =
  typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offered = event as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    offered = null;
    notify();
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Установка приложения: стоит ли оно уже и как его поставить. `install` показывает окно установки браузера
 * и возвращает `help` там, где браузер окна не даёт: тогда нужна подсказка про меню браузера.
 */
export function useInstall() {
  const prompt = useSyncExternalStore(
    subscribe,
    () => offered,
    () => null,
  );
  const isInstalled = useSyncExternalStore(
    subscribe,
    () => installed,
    () => false,
  );
  async function install(): Promise<'done' | 'help'> {
    if (!prompt) return 'help';
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      return 'help';
    } finally {
      // Событие одноразовое: после показа окна установки второго раза не будет.
      offered = null;
      notify();
    }
    return 'done';
  }
  return { installed: isInstalled, install };
}

export const INSTALL_HELP =
  'В меню браузера выберите «Установить приложение». На iPhone: Safari → «Поделиться» → «На экран Домой».';

/**
 * «Установить на телефон». Показывается только там, где человек сам ищет установку: на экранах
 * входа (по умолчанию) и в настройках (`inline`). Под нижним меню его нет; на «Сегодня» установку
 * предлагает отдельная карточка уведомлений (`PushCard`) и только пока они не включены.
 */
export function InstallApp({ inline = false }: { inline?: boolean }) {
  const { installed: isInstalled, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (isInstalled) return null;
  const content = (
    <>
      <button
        type="button"
        className="text-button"
        onClick={async () => {
          if ((await install()) === 'help') setHelp(!help);
        }}
      >
        Установить на телефон
      </button>
      {help && <p role="status">{INSTALL_HELP}</p>}
    </>
  );
  if (inline) return <Section title="Приложение на телефоне">{content}</Section>;
  return (
    <aside className="install-app" aria-label="Установка приложения">
      {content}
    </aside>
  );
}
