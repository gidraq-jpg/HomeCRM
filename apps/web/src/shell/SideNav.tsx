import { House } from '@phosphor-icons/react';
import { NavLink } from 'react-router';
import type { ShellSection } from './BottomNav.tsx';

/**
 * Боковое меню компьютера: те же пять разделов, что и в нижнем меню телефона (PRD, раздел 14).
 * До 960 px оно скрыто стилем, а не удалено: ширину окна знает только CSS.
 */
export function SideNav({ sections }: { sections: readonly ShellSection[] }) {
  return (
    <nav className="side-nav" aria-label="Основные разделы">
      <div className="side-nav__brand">
        <House size={26} aria-hidden />
        <span>HomeCRM</span>
      </div>
      <ul className="side-nav__list">
        {sections.map(({ to, label, icon: SectionIcon }) => (
          <li key={to}>
            <NavLink to={to} className="side-nav__link">
              {({ isActive }) => (
                <>
                  <SectionIcon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
