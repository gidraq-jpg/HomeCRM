import { Lock, UserPlus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';

interface SectionPlaceholderProps {
  title: string;
  icon: ReactNode;
  /** Короткий честный заголовок: «Объектов пока нет». */
  lead: string;
  /** Почему пусто и что можно сделать сейчас. */
  now: string;
  /** Что появится, когда раздел заработает: по PRD, раздел 14. */
  will: string;
  /** Блок над пустым состоянием: то, что в разделе уже работает (например, радар на «Сегодня»). */
  top?: ReactNode;
}

/**
 * Раздел, у которого ещё нет данных (TPL-4). Говорит правду: что здесь будет, что делать сейчас,
 * чем различаются личное и общее. Не обещает функций, которых в приложении нет.
 */
export function SectionPlaceholder({ title, icon, lead, now, will, top }: SectionPlaceholderProps) {
  const { scope, setScope } = useScope();
  const { isAdmin } = useHousehold();
  return (
    <Page title={title}>
      {top}
      <EmptyState
        icon={scope === 'personal' ? <Lock size={24} aria-hidden /> : icon}
        title={lead}
        actions={
          <>
            {isAdmin ? (
              <Link className="btn btn--primary btn--block" to="/people/invite">
                <UserPlus size={20} aria-hidden />
                Пригласить участника
              </Link>
            ) : null}
            <Link className="btn btn--secondary btn--block" to="/more/profile">
              Заполнить «Обо мне»
            </Link>
            {scope !== 'all' ? (
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={() => setScope('all')}
              >
                Показать «{SCOPE_LABELS.all}»
              </button>
            ) : null}
            <Link className="text-button" to="/more/spaces">
              Как устроены личное и общее
            </Link>
          </>
        }
      >
        <p>{now}</p>
        <p>{will}</p>
        {scope !== 'all' ? <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p> : null}
      </EmptyState>
    </Page>
  );
}
