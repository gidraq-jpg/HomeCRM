import { expect, it } from 'vitest';
import { sectionAdd } from './section-add.ts';

it('UI-7/D19a.14: полное меню только на Сегодня, разделы и карточки используют одну таблицу', () => {
  expect(sectionAdd('/today')).toMatchObject({ kind: 'menu' });
  for (const path of [
    '/today/plan',
    '/today/all',
    '/more',
    '/more/profile',
    '/home/month',
    '/documents/trash',
    '/more/notes/trash',
  ])
    expect(sectionAdd(path)).toMatchObject({ kind: 'quick', label: 'Добавить дело' });
  for (const [path, to] of [
    ['/home', '/home/new'],
    ['/documents', '/documents/new'],
    ['/people', '/people/contacts/new'],
    ['/more/notes', '/more/notes/new'],
    ['/more/organizations', '/more/organizations/new'],
  ]) {
    expect(sectionAdd(path ?? '')).toMatchObject({ kind: 'route', to });
    expect(sectionAdd(`${path}/fictional-id`)).toMatchObject({ kind: 'route', to });
  }
  expect(sectionAdd('/more/shopping')).toMatchObject({ kind: 'shopping' });
});
