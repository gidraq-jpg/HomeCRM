import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope } from '../access/scope.ts';
import { useTrashedAccounts } from '../accounts/queries.ts';
import { useTrashedDeadlines } from '../deadlines/queries.ts';
import { NO_FILTERS } from '../documents/api.ts';
import { useDocumentsList } from '../documents/queries.ts';
import { useTrashedFiles } from '../files/queries.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { useNotesList } from '../notes/queries.ts';
import { useObjectsList } from '../objects/queries.ts';
import { useOrganizationsList } from '../organizations/queries.ts';
import { useContactsList } from '../people/queries.ts';
import { useTaskList } from '../tasks/queries.ts';

/**
 * Загрузки корзины по видам записей. У каждого вида своя загрузка и ошибка: сбой одного блока не
 * ломает другие.
 */
export function useTrashQueries() {
  return {
    notesQuery: useNotesList(true),
    tasksQuery: useTaskList({}, true),
    objectsQuery: useObjectsList(true),
    filesQuery: useTrashedFiles(),
    deadlinesQuery: useTrashedDeadlines(),
    organizationsQuery: useOrganizationsList(true, null),
    accountsQuery: useTrashedAccounts(),
    documentsQuery: useDocumentsList({ ...NO_FILTERS, status: 'all' }, true),
    peopleQuery: useContactsList({ kind: 'person', category: null, query: '' }, true),
  };
}

export type TrashQueries = ReturnType<typeof useTrashQueries>;

/** Записи корзины в текущем режиме, их общее число и признак незагруженного блока. */
export function useTrashContents(queries: TrashQueries) {
  const { scope } = useScope();
  const {
    notesQuery,
    tasksQuery,
    objectsQuery,
    filesQuery,
    deadlinesQuery,
    organizationsQuery,
    accountsQuery,
    documentsQuery,
    peopleQuery,
  } = queries;
  const notes = notesQuery.data?.pages.flat() ?? [];
  const objects = objectsQuery.data?.pages.flat() ?? [];
  const files = filesQuery.data ?? [];
  const deadlines = (deadlinesQuery.data ?? []).filter((item) =>
    matchesScope(visibilityOf(item), scope),
  );
  const organizations = (organizationsQuery.data?.pages.flat() ?? []).filter((item) =>
    matchesScope(visibilityOf(item), scope),
  );
  const accounts = accountsQuery.data ?? [];
  const documents = documentsQuery.data?.pages.flat() ?? [];
  const total =
    (tasksQuery.data?.pages.flat().length ?? 0) +
    notes.length +
    objects.length +
    files.length +
    deadlines.length +
    organizations.length +
    accounts.length +
    documents.length +
    (peopleQuery.data?.pages.flat().length ?? 0);
  const failed =
    tasksQuery.isPending ||
    tasksQuery.isError ||
    notesQuery.data === undefined ||
    objectsQuery.data === undefined ||
    filesQuery.isError ||
    deadlinesQuery.isError ||
    deadlinesQuery.isPending ||
    organizationsQuery.isError ||
    organizationsQuery.isPending ||
    accountsQuery.isError ||
    accountsQuery.isPending ||
    documentsQuery.isError ||
    documentsQuery.isPending ||
    peopleQuery.isPending ||
    peopleQuery.isError;
  return { notes, objects, files, deadlines, organizations, accounts, documents, total, failed };
}
