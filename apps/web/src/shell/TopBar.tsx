import { MagnifyingGlass, UserCircle, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Link, useNavigate } from './motion.tsx';
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
  const { scope } = useScope();
  const [choosing, setChoosing] = useState(false);

  return (
    <header className="topbar">
      {studio ? (
        <Link className="topbar__brand" to="/today" aria-label="HomeCRM: сегодня">
          <StudioBrand />
        </Link>
      ) : null}
      {!studio && scopeVisible ? <ScopeSwitch /> : null}
      {studio && scopeVisible ? (
        <>
          <button
            className="scope-button"
            type="button"
            aria-label={`Пространство: ${SCOPE_LABELS[scope]}`}
            onClick={() => setChoosing(true)}
          >
            {SCOPE_LABELS[scope]} <span aria-hidden>▾</span>
          </button>
          <Sheet
            open={choosing}
            onOpenChange={setChoosing}
            title="Пространство"
            description="Какие записи показывать во всех разделах"
          >
            <ScopeSwitch />
            <p className="muted">{EMPTY_SCOPE_EXPLANATION[scope]}</p>
            <Link className="text-button" to="/more/spaces" onClick={() => setChoosing(false)}>
              Как устроены личное и общее
            </Link>
          </Sheet>
        </>
      ) : null}
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
    </header>
  );
}
