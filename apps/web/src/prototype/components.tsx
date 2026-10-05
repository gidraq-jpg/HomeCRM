import { Lock, MagnifyingGlass, Plus, Question } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
import { useAddRequest } from './add-request.tsx';
import type { RecordKind } from './model.ts';

interface ScopeEmptyProps {
  title: string;
  /** Что ещё сказать про этот раздел помимо общего объяснения. */
  children?: ReactNode;
  /** Какую запись предложить создать первой. */
  addKind?: RecordKind;
  addLabel?: string;
  /** Предложить переключиться, если записи есть в другом режиме. */
  offerShowAll?: boolean;
}

/**
 * Пустой раздел: объясняет разницу личного и общего и предлагает первое действие
 * (PRD, раздел 7.4 и TPL-4).
 */
export function ScopeEmpty({
  title,
  children,
  addKind,
  addLabel,
  offerShowAll = true,
}: ScopeEmptyProps) {
  const { scope, setScope } = useScope();
  const requestAdd = useAddRequest();
  return (
    <EmptyState
      icon={
        scope === 'personal' ? <Lock size={24} aria-hidden /> : <Question size={24} aria-hidden />
      }
      title={title}
      actions={
        <>
          {addKind && addLabel ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => requestAdd(addKind)}
            >
              <Plus size={20} weight="bold" aria-hidden />
              {addLabel}
            </button>
          ) : null}
          {offerShowAll && scope !== 'all' ? (
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
      <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
      {children ? <p>{children}</p> : null}
    </EmptyState>
  );
}

/** Экран для адреса, по которому ничего нет. */
export function NotFoundScreen({ what = 'Такой записи нет' }: { what?: string }) {
  return (
    <Page title={what}>
      <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Не нашли">
        <p>Возможно, запись удалили или ссылка устарела.</p>
      </EmptyState>
      <div className="btn-row">
        <Link className="btn btn--primary" to="/today">
          На «Сегодня»
        </Link>
      </div>
    </Page>
  );
}
