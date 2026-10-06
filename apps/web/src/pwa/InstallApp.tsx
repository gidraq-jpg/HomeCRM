import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches,
  );
  useEffect(() => {
    const offer = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  if (installed) return null;
  return (
    <aside className="install-app" aria-label="Установка приложения">
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
            setPrompt(null);
          } catch {
            setHelp(true);
            setPrompt(null);
          }
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
    </aside>
  );
}
