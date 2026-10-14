import { MagnifyingGlass, UserCircle, X } from '@phosphor-icons/react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ScopeSwitch } from './ScopeSwitch.tsx';
import { StudioBrand } from './StudioBrand.tsx';
import { isStudio } from './studio.ts';

export const SEARCH_PATH = '/search';

/** Шапка: переключатель «Всё · Общее · Личное» и поиск — на каждом экране (PRD, раздел 14). */
export function TopBar({ scopeVisible = true }: { scopeVisible?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const inSearch = location.pathname === SEARCH_PATH;
  const studio = isStudio();

  return (
    <header className="topbar">
      {studio ? (
        <Link className="topbar__brand" to="/today" aria-label="HomeCRM: сегодня">
          <StudioBrand />
        </Link>
      ) : null}
      {!studio && scopeVisible ? <ScopeSwitch /> : null}
      {inSearch ? (
        <button
          type="button"
          className="icon-button icon-button--soft topbar__search"
          aria-label="Закрыть поиск"
          onClick={() => {
            // «default» — первый адрес сеанса: назад идти некуда, возвращаем на «Сегодня».
            if (location.key === 'default') navigate('/today');
            else navigate(-1);
          }}
        >
          <X size={24} aria-hidden />
        </button>
      ) : (
        <Link
          className="icon-button icon-button--soft topbar__search"
          to={SEARCH_PATH}
          aria-label="Поиск"
        >
          <MagnifyingGlass size={24} aria-hidden />
        </Link>
      )}
      {studio ? (
        <Link className="icon-button topbar__profile" to="/more/profile" aria-label="Обо мне">
          <UserCircle size={28} aria-hidden />
        </Link>
      ) : null}
      {studio && scopeVisible ? <ScopeSwitch /> : null}
    </header>
  );
}
