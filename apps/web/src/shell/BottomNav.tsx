import type { Icon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';
import { isStudio } from './studio.ts';

export interface ShellSection {
  to: string;
  label: string;
  icon: Icon;
}

/** Адрес покупок сохранён для ссылок и офлайн-снимка; раздел — «Сегодня». */
export function radarFromToday(_search: string, state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fromSection' in state &&
    state.fromSection === 'today'
  );
}
export function sectionActive(to: string, pathname: string, search = '', state?: unknown): boolean {
  if (isStudio() && (pathname === '/more/shopping' || pathname.startsWith('/more/shopping/')))
    return to === '/today';
  if (isStudio() && pathname === '/more/radar' && radarFromToday(search, state))
    return to === '/today';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Нижнее меню из пяти пунктов — PRD, раздел 14. Текущий раздел отмечен `aria-current`. */
export function BottomNav({ sections }: { sections: readonly ShellSection[] }) {
  const { pathname, search, state } = useLocation();
  return (
    <nav className="bottom-nav" aria-label="Основные разделы">
      <ul className="bottom-nav__list">
        {sections.map(({ to, label, icon: SectionIcon }) => (
          <li key={to}>
            <Link
              to={to}
              className="bottom-nav__link"
              aria-label={isStudio() && label === 'Документы' ? label : undefined}
              aria-current={sectionActive(to, pathname, search, state) ? 'page' : undefined}
            >
              <SectionIcon
                size={25}
                weight={sectionActive(to, pathname, search, state) ? 'fill' : 'regular'}
                aria-hidden
              />
              <span className="bottom-nav__label">
                {isStudio() && label === 'Документы' ? 'Док.' : label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
