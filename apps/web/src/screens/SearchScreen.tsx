import { MagnifyingGlass } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';

/** Поиск: искать пока нечего — в приложении нет записей, только состав дома. */
export function SearchScreen() {
  return (
    <Page title="Поиск">
      <EmptyState
        icon={<MagnifyingGlass size={24} aria-hidden />}
        title="Искать пока нечего"
        actions={
          <Link className="btn btn--secondary btn--block" to="/people">
            Открыть «Люди»
          </Link>
        }
      >
        <p>
          Поиск работает по записям: делам, документам, заметкам. Их в приложении ещё нет.
          Участников дома можно найти в разделе «Люди».
        </p>
        <p>Личные записи поиск показывает только их владельцу.</p>
      </EmptyState>
    </Page>
  );
}
