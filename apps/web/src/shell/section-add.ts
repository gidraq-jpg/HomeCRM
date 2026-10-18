type AddTarget =
  | { kind: 'menu' | 'quick' | 'shopping'; label: string }
  | { kind: 'route'; label: string; to: string };

/** Единственное сопоставление «+» разделу: UI-7, решение владельца D19a.14. */
const SECTION_ADD: readonly { matches: RegExp; target: AddTarget }[] = [
  { matches: /^\/today\/?$/, target: { kind: 'menu', label: 'Добавить' } },
  {
    matches: /^\/(?:home\/month|documents\/trash|more\/(?:notes|organizations)\/trash)(?:\/|$)/,
    target: { kind: 'quick', label: 'Добавить дело' },
  },
  { matches: /^\/more\/shopping(?:\/|$)/, target: { kind: 'shopping', label: 'Добавить покупку' } },
  {
    matches: /^\/home(?:\/|$)/,
    target: { kind: 'route', label: 'Добавить объект', to: '/home/new' },
  },
  {
    matches: /^\/documents(?:\/|$)/,
    target: { kind: 'route', label: 'Добавить документ', to: '/documents/new' },
  },
  {
    matches: /^\/people(?:\/|$)/,
    target: { kind: 'route', label: 'Добавить человека', to: '/people/contacts/new' },
  },
  {
    matches: /^\/more\/notes(?:\/|$)/,
    target: { kind: 'route', label: 'Добавить заметку', to: '/more/notes/new' },
  },
  {
    matches: /^\/more\/organizations(?:\/|$)/,
    target: { kind: 'route', label: 'Добавить организацию', to: '/more/organizations/new' },
  },
];
export function sectionAdd(pathname: string): AddTarget {
  return (
    SECTION_ADD.find((entry) => entry.matches.test(pathname))?.target ?? {
      kind: 'quick',
      label: 'Добавить дело',
    }
  );
}
