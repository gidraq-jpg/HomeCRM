import { House } from '@phosphor-icons/react';
import { useLocation } from 'react-router';
import { type ShellSection, sectionActive } from './BottomNav.tsx';
import { Link } from './motion.tsx';
import { StudioBrand } from './StudioBrand.tsx';
import { isStudio } from './studio.ts';
import { useSectionNav } from './useSectionNav.ts';

/**
 * Боковое меню компьютера: те же пять разделов, что и в нижнем меню телефона (PRD, раздел 14).
 * До 960 px оно скрыто стилем, а не удалено: ширину окна знает только CSS.
 */
export function SideNav({ sections }: { sections: readonly ShellSection[] }) {
  const { pathname, search, state } = useLocation();
  const { nav, choose } = useSectionNav();
  return (
    <nav ref={nav} className="side-nav" aria-label="Основные разделы">
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
        {isStudio() ? <li className="section-indicator" aria-hidden hidden /> : null}
        {sections.map(({ to, label, icon: SectionIcon }) => (
          <li key={to}>
            <Link
              to={to}
              onClick={(event) => choose(event, to, sectionActive(to, pathname, search, state))}
              className="side-nav__link"
              aria-current={sectionActive(to, pathname, search, state) ? 'page' : undefined}
            >
              <span className="section-icon">
                <SectionIcon
                  size={24}
                  weight={sectionActive(to, pathname, search, state) ? 'fill' : 'regular'}
                  aria-hidden
                />
              </span>
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
