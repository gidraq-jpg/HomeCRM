import type { Icon } from '@phosphor-icons/react';
import { NavLink } from 'react-router';

export interface ShellSection {
  to: string;
  label: string;
  icon: Icon;
}

/** Нижнее меню из пяти пунктов — PRD, раздел 14. Текущий раздел отмечен `aria-current`. */
export function BottomNav({ sections }: { sections: readonly ShellSection[] }) {
  return (
    <nav className="bottom-nav" aria-label="Основные разделы">
      <ul className="bottom-nav__list">
        {sections.map(({ to, label, icon: SectionIcon }) => (
          <li key={to}>
            <NavLink to={to} className="bottom-nav__link">
              {({ isActive }) => (
                <>
                  <SectionIcon size={25} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                  <span className="bottom-nav__label">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
