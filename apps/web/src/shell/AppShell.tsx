import { Plus } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router';
import { ToastRegion } from '../ui/Toast.tsx';
import { BottomNav, type ShellSection } from './BottomNav.tsx';
import { SideNav } from './SideNav.tsx';
import { TopBar } from './TopBar.tsx';
import { useKeyboardAttribute } from './useKeyboardAttribute.ts';

interface AppShellProps {
  sections: readonly ShellSection[];
  /** Нажата кнопка «+». Что именно добавлять и как — решает приложение, каркас этого не знает. */
  onAdd: () => void;
  /** Окна поверх экрана: например, панель добавления. */
  overlays?: ReactNode;
  children: ReactNode;
}

/**
 * Каркас приложения: шапка с поиском и переключателем «Всё · Общее · Личное», нижнее меню
 * из пяти разделов на телефоне, боковое меню на компьютере и кнопка «+», доступная на всех
 * экранах (PRD, раздел 14). Какое из двух меню видно, решает ширина окна (shell.css).
 */
export function AppShell({ sections, onAdd, overlays, children }: AppShellProps) {
  const { pathname } = useLocation();
  useKeyboardAttribute();

  // Новый экран открывается сверху, как после перехода по ссылке.
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка зависит от адреса, а не от значения внутри эффекта
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <SideNav sections={sections} />
      <div className="app__content">
        <TopBar />
        <main className="main" id="main">
          {children}
        </main>
      </div>
      <div className="chrome">
        <aside className="chrome__actions" aria-label="Быстрые действия">
          <ToastRegion />
          <button type="button" className="fab" aria-label="Добавить" onClick={onAdd}>
            <Plus size={28} weight="bold" aria-hidden />
          </button>
        </aside>
        <BottomNav sections={sections} />
      </div>
      {overlays}
    </div>
  );
}
