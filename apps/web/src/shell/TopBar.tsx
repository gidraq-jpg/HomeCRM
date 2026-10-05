import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ScopeSwitch } from './ScopeSwitch.tsx';

export const SEARCH_PATH = '/search';

/** Шапка: переключатель «Всё · Общее · Личное» и поиск — на каждом экране (PRD, раздел 14). */
export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const inSearch = location.pathname === SEARCH_PATH;

  return (
    <header className="topbar">
      <ScopeSwitch />
      {inSearch ? (
        <button
          type="button"
          className="icon-button icon-button--soft"
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
        <Link className="icon-button icon-button--soft" to={SEARCH_PATH} aria-label="Поиск">
          <MagnifyingGlass size={24} aria-hidden />
        </Link>
      )}
    </header>
  );
}
