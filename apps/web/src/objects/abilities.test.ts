import { describe, expect, it } from 'vitest';
import type { Member } from '../household/api.ts';
import { viewerOf } from '../notes/abilities.ts';
import {
  assigneeChoices,
  creatableObjectVisibilities,
  eventAbilities,
  objectAbilities,
} from './abilities.ts';
import type { ObjectSummary } from './api.ts';

// Вымышленная семья: Анна — администратор, Борис — взрослый, Вера — ребёнок.
const HOUSE = 'house-1';
const people = {
  anna: { id: 'anna', roles: [{ householdId: HOUSE, role: 'admin' as const }] },
  boris: { id: 'boris', roles: [{ householdId: HOUSE, role: 'adult' as const }] },
  vera: { id: 'vera', roles: [{ householdId: HOUSE, role: 'child' as const }] },
};

function object(change: Partial<ObjectSummary> = {}): ObjectSummary {
  return {
    id: 'object-1',
    title: 'Квартира',
    objectType: 'property',
    typeData: {},
    spaceId: HOUSE,
    spaceKind: 'household',
    audience: 'adults',
    authorId: 'boris',
    assigneeId: 'boris',
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    deletedAt: null,
    ...change,
  };
}

const member = (accountId: string, role: Member['role'], formerMember = false): Member => ({
  accountId,
  displayName: accountId,
  role,
  isAdult: role !== 'child',
  formerMember,
  leftAt: null,
  photoFileId: null,
  birthDate: null,
  birthdayEnabled: false,
  phone: null,
});

describe('действия с объектом по правилам доступа', () => {
  it('взрослый правит общий объект, ребёнок — нет', () => {
    expect(objectAbilities(viewerOf(people.boris), object(), HOUSE).edit).toBe(true);
    const asChild = objectAbilities(
      viewerOf(people.vera),
      object({ audience: 'household' }),
      HOUSE,
    );
    expect(asChild.edit).toBe(false);
    expect(asChild.trash).toBe(false);
    expect(asChild.copy).toBe(true);
  });

  it('ребёнок создаёт только личные объекты, взрослый — любые', () => {
    expect(creatableObjectVisibilities(viewerOf(people.vera), HOUSE)).toEqual(['personal']);
    expect(creatableObjectVisibilities(viewerOf(people.boris), HOUSE)).toEqual([
      'personal',
      'adults',
      'household',
    ]);
  });

  it('личный объект: можно поделиться; общего действия «Кто видит» нет', () => {
    const personal = object({
      spaceId: 'personal-boris',
      spaceKind: 'personal',
      audience: null,
    });
    const abilities = objectAbilities(viewerOf(people.boris), personal, HOUSE);
    expect(abilities).toMatchObject({ share: true, audience: false, copy: false });
  });

  it('объект в корзине не правят; вернуть общий может автор-взрослый и администратор', () => {
    const trashed = object({ deletedAt: '2026-10-06T08:00:00.000Z' });
    expect(objectAbilities(viewerOf(people.boris), trashed, HOUSE)).toMatchObject({
      edit: false,
      restore: true,
    });
    expect(objectAbilities(viewerOf(people.anna), trashed, HOUSE).restore).toBe(true);
    const other = object({ deletedAt: '2026-10-06T08:00:00.000Z', authorId: 'anna' });
    expect(objectAbilities(viewerOf(people.boris), other, HOUSE).restore).toBe(false);
  });

  it('событие: править и убирать в корзину можно только своё', () => {
    const own = { authorId: 'boris', deletedAt: null };
    const foreign = { authorId: 'anna', deletedAt: null };
    expect(eventAbilities(viewerOf(people.boris), object(), own, true)).toMatchObject({
      edit: true,
      trash: true,
    });
    expect(eventAbilities(viewerOf(people.boris), object(), foreign, true)).toMatchObject({
      edit: false,
      trash: false,
    });
    expect(eventAbilities(viewerOf(people.boris), object(), own, false).edit).toBe(false);
  });
});

describe('ответственный за объект', () => {
  const members = [
    member('anna', 'admin'),
    member('boris', 'adult'),
    member('vera', 'child'),
    member('olga', 'adult', true),
  ];

  it('при доступе «Взрослые» ребёнок в выборе не показывается, бывшие участники — тоже', () => {
    const ids = assigneeChoices(viewerOf(people.boris), object(), members).map((item) => item.id);
    expect(ids).toEqual(['anna', 'boris']);
  });

  it('при доступе «Вся семья» ребёнок среди кандидатов есть', () => {
    const ids = assigneeChoices(
      viewerOf(people.boris),
      object({ audience: 'household' }),
      members,
    ).map((item) => item.id);
    expect(ids).toEqual(['anna', 'boris', 'vera']);
  });

  it('у личного объекта ответственного не выбирают', () => {
    const personal = object({ spaceId: 'personal-boris', spaceKind: 'personal', audience: null });
    expect(assigneeChoices(viewerOf(people.boris), personal, members)).toEqual([]);
  });
});
