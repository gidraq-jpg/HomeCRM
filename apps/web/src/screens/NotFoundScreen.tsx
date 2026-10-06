import { MagnifyingGlass } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';

/** Адрес, по которому ничего нет. */
export function NotFoundScreen() {
  return (
    <Page title="Страница не найдена">
      <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Не нашли">
        <p>Возможно, ссылка устарела или раздел ещё не готов.</p>
      </EmptyState>
      <div className="btn-row">
        <Link className="btn btn--primary" to="/today">
          На «Сегодня»
        </Link>
      </div>
    </Page>
  );
}
