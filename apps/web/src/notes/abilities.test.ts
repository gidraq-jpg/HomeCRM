import { describe, expect, it } from 'vitest';
import {
  creatableVisibilities,
  newPlacement,
  noteAbilities,
  viewerOf,
  visibilityOf,
} from './abilities.ts';
import type { NoteSummary } from './api.ts';

// Вымышленная семья: Анна — администратор, Борис — взрослый, Вера — ребёнок.
const HOUSE = 'house-1';
const roles = {
  anna: { id: 'anna', roles: [{ householdId: HOUSE, role: 'admin' as const }] },
  boris: { id: 'boris', roles: [{ householdId: HOUSE, role: 'adult' as const }] },
  vera: { id: 'vera', roles: [{ householdId: HOUSE, role: 'child' as const }] },
};

function note(change: Partial<NoteSummary>): NoteSummary {
  return {
    id: 'note-1',
    title: 'Заметка',
    pinned: false,
    spaceId: 'personal-boris',
    spaceKind: 'personal',
    audience: null,
    authorId: 'boris',
    assigneeId: 'boris',
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    deletedAt: null,
    ...change,
  };
}
const shared = (change: Partial<NoteSummary> = {}) =>
  note({
    spaceId: HOUSE,
    spaceKind: 'household',
    audience: 'household',
    assigneeId: null,
    ...change,
  });

describe('действия с заметкой по правилам доступа', () => {
  it('владелец личной заметки может поделиться, править, удалить; копировать и менять аудиторию нечего', () => {
    const abilities = noteAbilities(viewerOf(roles.boris), note({}), HOUSE);
    expect(abilities).toEqual({
      edit: true,
      trash: true,
      restore: true,
      share: true,
      audience: false,
      makePersonal: false,
      copy: false,
    });
  });

  it('автор общей заметки может сделать её личной, сменить аудиторию и скопировать', () => {
    const abilities = noteAbilities(viewerOf(roles.boris), shared(), HOUSE);
    expect(abilities).toMatchObject({
      share: false,
      audience: true,
      makePersonal: true,
      copy: true,
      edit: true,
      trash: true,
    });
  });

  it('другой взрослый общую заметку правит и меняет аудиторию, но личной не делает', () => {
    const abilities = noteAbilities(viewerOf(roles.anna), shared({ authorId: 'boris' }), HOUSE);
    expect(abilities).toMatchObject({
      edit: true,
      audience: true,
      makePersonal: false,
      copy: true,
    });
  });

  it('ребёнок общую заметку только читает и копирует в личное', () => {
    const abilities = noteAbilities(viewerOf(roles.vera), shared(), HOUSE);
    expect(abilities).toEqual({
      edit: false,
      trash: false,
      restore: false,
      share: false,
      audience: false,
      makePersonal: false,
      copy: true,
    });
  });

  it('ребёнок своё личное правит и удаляет, но поделиться им не может (PRD 6.2)', () => {
    const abilities = noteAbilities(
      viewerOf(roles.vera),
      note({ authorId: 'vera', assigneeId: 'vera' }),
      HOUSE,
    );
    expect(abilities).toMatchObject({ edit: true, trash: true, share: false });
  });

  it('без дома поделиться нельзя', () => {
    expect(noteAbilities(viewerOf({ id: 'boris', roles: [] }), note({}), null).share).toBe(false);
  });

  it('заметка в корзине: править и переносить нельзя; вернуть — по правилам корзины', () => {
    const trashed = shared({ deletedAt: '2026-10-06T08:00:00.000Z', authorId: 'boris' });
    const own = noteAbilities(viewerOf(roles.boris), trashed, HOUSE);
    expect(own).toMatchObject({ edit: false, share: false, makePersonal: false, copy: false });
    expect(own.restore).toBe(true);
    // Взрослый, не автор, вернуть общую заметку не может; администратор — может.
    expect(noteAbilities(viewerOf(roles.anna), trashed, HOUSE).restore).toBe(true);
    const other = shared({ deletedAt: '2026-10-06T08:00:00.000Z', authorId: 'anna' });
    expect(noteAbilities(viewerOf(roles.boris), other, HOUSE).restore).toBe(false);
  });
});

describe('значения «Кто видит» для новой заметки', () => {
  it('взрослому доступны все три значения', () => {
    expect(creatableVisibilities(viewerOf(roles.boris), HOUSE)).toEqual([
      'personal',
      'adults',
      'household',
    ]);
  });

  it('ребёнку — только личное: общие заметки по PRD 6.2 создают взрослые', () => {
    expect(creatableVisibilities(viewerOf(roles.vera), HOUSE)).toEqual(['personal']);
  });

  it('без дома — только личное', () => {
    expect(creatableVisibilities(viewerOf({ id: 'boris', roles: [] }), null)).toEqual(['personal']);
  });

  it('место для сервера: у личной его нет, у общей — дом и аудитория', () => {
    expect(newPlacement('personal', HOUSE)).toBeUndefined();
    expect(newPlacement('adults', HOUSE)).toEqual({ spaceId: HOUSE, audience: 'adults' });
    expect(newPlacement('household', null)).toBeUndefined();
  });
});

describe('подпись «Кто видит»', () => {
  it('личная, взрослые, вся семья', () => {
    expect(visibilityOf(note({}))).toBe('personal');
    expect(visibilityOf(shared({ audience: 'adults' }))).toBe('adults');
    expect(visibilityOf(shared())).toBe('household');
  });
});
