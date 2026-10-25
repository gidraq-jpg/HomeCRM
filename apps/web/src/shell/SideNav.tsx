import { House } from '@phosphor-icons/react';
import { useLocation } from 'react-router';
import { type ShellSection, sectionActive } from './BottomNav.tsx';
import { Link } from './motion.tsx';
import { StudioBrand } from './StudioBrand.tsx';
import { isStudio } from './studio.ts';

/**
 * Боковое меню компьютера: те же пять разделов, что и в нижнем меню телефона (PRD, раздел 14).
 * До 960 px оно скрыто стилем, а не удалено: ширину окна знает только CSS.
 */
export function SideNav({ sections }: { sections: readonly ShellSection[] }) {
  const { pathname, search, state } = useLocation();
  return (
    <nav className="side-nav" aria-label="Основные разделы">
      <div className="side-nav__brand">
        {isStudio() ? (
          <StudioBrand />
        ) : (
          <>
            <House size={26} aria-hidden />
            <span>HomeCRM</span>
          </>
        )}
      </div>
      <ul className="side-nav__list">
        {sections.map(({ to, label, icon: SectionIcon }) => (
          <li key={to}>
            <Link
              to={to}
              className="side-nav__link"
              aria-current={sectionActive(to, pathname, search, state) ? 'page' : undefined}
            >
              <SectionIcon
                size={24}
                weight={sectionActive(to, pathname, search, state) ? 'fill' : 'regular'}
                aria-hidden
              />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
