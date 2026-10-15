import { Plus } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router';
import { ToastRegion } from '../ui/Toast.tsx';
import { AddActionContext } from './AddAction.tsx';
import { BottomNav, type ShellSection } from './BottomNav.tsx';
import { SideNav } from './SideNav.tsx';
import { isStudio } from './studio.ts';
import { TopBar } from './TopBar.tsx';
import { useKeyboardAttribute } from './useKeyboardAttribute.ts';

interface AppShellProps {
  sections: readonly ShellSection[];
  /** Нажата кнопка «+». Что именно добавлять и как — решает приложение, каркас этого не знает. */
  onAdd: () => void;
  /** Окна поверх экрана: например, панель добавления. */
  overlays?: ReactNode;
  /** D2 отключает верхний экземпляр только после переноса переключателя в панель «Сегодня». */
  scopeVisible?: boolean;
  children: ReactNode;
}

/**
 * Каркас приложения: шапка с поиском и переключателем «Всё · Общее · Личное», нижнее меню
 * из пяти разделов на телефоне, боковое меню на компьютере и кнопка «+», доступная на всех
 * экранах (PRD, раздел 14). Какое из двух меню видно, решает ширина окна (shell.css).
 */
export function AppShell({
  sections,
  onAdd,
  overlays,
  scopeVisible = true,
  children,
}: AppShellProps) {
  const { pathname } = useLocation();
  useKeyboardAttribute();

  // Новый экран открывается сверху, как после перехода по ссылке.
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка зависит от адреса, а не от значения внутри эффекта
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <AddActionContext.Provider value={onAdd}>
      <div className="app">
        <SideNav sections={sections} />
        <div className="app__content">
          <TopBar scopeVisible={scopeVisible} />
          <main className="main" id="main">
            {children}
          </main>
        </div>
        <div className="chrome">
          <aside className="chrome__actions" aria-label="Быстрые действия">
            <ToastRegion />
            {!isStudio() ? (
              <button type="button" className="fab" aria-label="Добавить" onClick={onAdd}>
                <Plus size={28} weight="bold" aria-hidden />
              </button>
            ) : null}
          </aside>
          <BottomNav sections={sections} />
        </div>
        {overlays}
      </div>
    </AddActionContext.Provider>
  );
}
