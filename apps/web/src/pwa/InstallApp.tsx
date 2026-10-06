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
 * «Установить на телефон». Показывается только там, где человек сам ищет установку: на экранах
 * входа (по умолчанию) и в настройках (`inline`). Под нижним меню и на «Сегодня» его нет.
 */
export function InstallApp({ inline = false }: { inline?: boolean }) {
  const prompt = useSyncExternalStore(subscribe, () => offered);
  const isInstalled = useSyncExternalStore(subscribe, () => installed);
  const [help, setHelp] = useState(false);
  if (isInstalled) return null;
  const content = (
    <>
      <button
        type="button"
        className="text-button"
        onClick={async () => {
          if (!prompt) {
            setHelp(!help);
            return;
          }
          try {
            await prompt.prompt();
            await prompt.userChoice;
          } catch {
            setHelp(true);
          }
          // Событие одноразовое: после показа окна установки второго раза не будет.
          offered = null;
          notify();
        }}
      >
        Установить на телефон
      </button>
      {help && (
        <p role="status">
          В меню браузера выберите «Установить приложение». На iPhone: Safari → «Поделиться» → «На
          экран Домой».
        </p>
      )}
    </>
  );
  if (inline) return <Section title="Приложение на телефоне">{content}</Section>;
  return (
    <aside className="install-app" aria-label="Установка приложения">
      {content}
    </aside>
  );
}
